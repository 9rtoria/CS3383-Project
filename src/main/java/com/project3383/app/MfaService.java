package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.qrcode.QRCodeWriter;
import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.imageio.ImageIO;

@Service
public class MfaService {

    private static final String BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final String BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOTP_STEP_SECONDS = 30;
    private static final int TOTP_DIGITS = 6;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String keyFile;
    private final ConcurrentHashMap<String, Challenge> challenges = new ConcurrentHashMap<>();
    private volatile byte[] encryptionKey;

    public MfaService(JdbcTemplate jdbc, ObjectMapper objectMapper,
                      @Value("${project3383.mfa-key-file:data/mfa.key}") String keyFile) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.keyFile = keyFile;
    }

    public Map<String, Object> status(String userId, String currentSessionId) {
        Map<String, Object> user = user(userId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mfaEnabled", number(user.get("mfaEnabled")) == 1);
        List<Map<String, Object>> sessions = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList("""
            SELECT id, created_at AS createdAt, last_used_at AS lastUsedAt, user_agent AS userAgent
            FROM auth_session WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC LIMIT 20
            """, userId, Instant.now().toString())) {
            row.put("current", currentSessionId != null && currentSessionId.equals(String.valueOf(row.get("id"))));
            sessions.add(row);
        }
        if (sessions.stream().noneMatch(row -> Boolean.TRUE.equals(row.get("current")))) {
            Map<String, Object> current = new LinkedHashMap<>();
            current.put("id", currentSessionId == null ? "current" : currentSessionId);
            current.put("createdAt", Instant.now().toString());
            current.put("lastUsedAt", Instant.now().toString());
            current.put("userAgent", "This browser");
            current.put("current", true);
            sessions.add(0, current);
        }
        result.put("sessions", sessions);
        return result;
    }

    @Transactional
    public Map<String, Object> setup(String userId, String currentCode) {
        Map<String, Object> user = user(userId);
        if (number(user.get("mfaEnabled")) == 1) {
            String existing = decrypt(stringValue(user.get("mfaSecret")));
            if (currentCode == null || currentCode.isBlank()) {
                throw ApiException.badRequest("Enter your current authenticator code to reset two-factor.");
            }
            if (!verifyCode(userId, existing, stringValue(user.get("backupCodes")), currentCode, false)) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                    "That authenticator code is not valid.");
            }
        }
        String secret = generateSecret();
        jdbc.update("""
            UPDATE app_user SET mfa_secret_enc = ?, mfa_enabled = 0 WHERE id = ?
            """, encrypt(secret), userId);
        String email = stringValue(user.get("email"));
        String label = email == null || email.isBlank() ? "guest@drift.local" : email;
        String uri = "otpauth://totp/Drift:" + urlEncode(label)
            + "?secret=" + secret + "&issuer=Drift&algorithm=SHA1&digits=6&period=30";
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("secret", secret);
        result.put("uri", uri);
        result.put("qrDataUrl", qrDataUrl(uri));
        return result;
    }

    @Transactional
    public Map<String, Object> enable(String userId, ApiDtos.MfaRequest input) {
        if (input == null || input.secret() == null || input.secret().isBlank()) {
            throw ApiException.badRequest("Start two-factor setup first.");
        }
        Map<String, Object> user = user(userId);
        String stored = decrypt(stringValue(user.get("mfaSecret")));
        if (stored == null || !stored.equals(input.secret().trim())) {
            throw ApiException.badRequest("The setup secret changed. Start again.");
        }
        if (input.code() == null || !verifyTotp(stored, input.code().trim())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                "That code is not valid. Check your authenticator time.");
        }
        List<String> backupCodes = generateBackupCodes();
        List<String> hashed = backupCodes.stream().map(this::hashBackupCode).toList();
        jdbc.update("""
            UPDATE app_user SET mfa_enabled = 1, mfa_backup_codes_json = ? WHERE id = ?
            """, json(hashed), userId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("backupCodes", backupCodes);
        return result;
    }

    @Transactional
    public Map<String, Object> disable(String userId, String code) {
        Map<String, Object> user = user(userId);
        if (number(user.get("mfaEnabled")) != 1) throw ApiException.badRequest("Two-factor is not enabled.");
        Integer required = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND w.require_mfa = 1 AND w.deleted_at IS NULL
            """, Integer.class, userId);
        if (required != null && required > 0) {
            throw ApiException.forbidden("An organization you belong to requires MFA. Ask an admin before disabling it.");
        }
        String secret = decrypt(stringValue(user.get("mfaSecret")));
        if (code == null || !verifyCode(userId, secret, stringValue(user.get("backupCodes")), code, false)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "That code is not valid.");
        }
        jdbc.update("""
            UPDATE app_user SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_backup_codes_json = NULL
            WHERE id = ?
            """, userId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mfaEnabled", false);
        return result;
    }

    public String createChallenge(String userId) {
        String token = randomToken(32);
        challenges.put(token, new Challenge(userId, Instant.now().plusSeconds(300)));
        Instant cutoff = Instant.now();
        challenges.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(cutoff));
        return token;
    }

    public String verifyChallenge(String token, String code) {
        if (token == null || token.isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "Sign in again.");
        }
        Challenge challenge = challenges.remove(token);
        if (challenge == null || challenge.expiresAt().isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "The verification window expired. Sign in again.");
        }
        if (!verifySecondFactor(challenge.userId(), code)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "That code is not valid.");
        }
        return challenge.userId();
    }

    public void revokeSession(String userId, String sessionId) {
        jdbc.update("""
            UPDATE auth_session SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL
            """, Instant.now().toString(), sessionId, userId);
    }

    public boolean mfaEnabled(String userId) {
        Integer enabled = jdbc.queryForObject("""
            SELECT mfa_enabled FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, Integer.class, userId);
        return enabled != null && enabled == 1;
    }

    public boolean verifySecondFactor(String userId, String code) {
        Map<String, Object> user = user(userId);
        return verifyCode(userId, decrypt(stringValue(user.get("mfaSecret"))),
            stringValue(user.get("backupCodes")), code, true);
    }

    private boolean verifyCode(String userId, String secret, String backupCodesJson, String code,
                               boolean consumeBackup) {
        if (code == null) return false;
        String normalized = code.trim();
        if (secret != null && verifyTotp(secret, normalized)) return true;
        List<String> hashes = parseBackupCodes(backupCodesJson);
        String target = hashBackupCode(normalized);
        int index = hashes.indexOf(target);
        if (index < 0) return false;
        if (consumeBackup) {
            List<String> remaining = new ArrayList<>(hashes);
            remaining.remove(index);
            jdbc.update("UPDATE app_user SET mfa_backup_codes_json = ? WHERE id = ?", json(remaining), userId);
        }
        return true;
    }

    private Map<String, Object> user(String userId) {
        return jdbc.queryForList("""
            SELECT id, email, mfa_enabled AS mfaEnabled, mfa_secret_enc AS mfaSecret,
                   mfa_backup_codes_json AS backupCodes
            FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, userId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Account not found."));
    }

    private List<String> parseBackupCodes(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception exception) {
            return List.of();
        }
    }

    private String generateSecret() {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        return base32Encode(bytes);
    }

    private List<String> generateBackupCodes() {
        List<String> codes = new ArrayList<>();
        for (int index = 0; index < 8; index++) {
            codes.add(group(5) + "-" + group(5));
        }
        return codes;
    }

    private String group(int length) {
        StringBuilder value = new StringBuilder();
        for (int index = 0; index < length; index++) {
            value.append(BACKUP_ALPHABET.charAt(RANDOM.nextInt(BACKUP_ALPHABET.length())));
        }
        return value.toString();
    }

    private String base32Encode(byte[] bytes) {
        StringBuilder output = new StringBuilder();
        int buffer = 0;
        int bits = 0;
        for (byte value : bytes) {
            buffer = (buffer << 8) | (value & 0xff);
            bits += 8;
            while (bits >= 5) {
                output.append(BASE32.charAt((buffer >> (bits - 5)) & 0x1f));
                bits -= 5;
            }
        }
        if (bits > 0) output.append(BASE32.charAt((buffer << (5 - bits)) & 0x1f));
        return output.toString();
    }

    private byte[] base32Decode(String secret) {
        int buffer = 0;
        int bits = 0;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (char character : secret.toUpperCase().toCharArray()) {
            int value = BASE32.indexOf(character);
            if (value < 0) continue;
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8) {
                output.write((buffer >> (bits - 8)) & 0xff);
                bits -= 8;
            }
        }
        return output.toByteArray();
    }

    private boolean verifyTotp(String secret, String code) {
        if (secret == null || code == null || !code.matches("\\d{6}")) return false;
        long counter = Instant.now().getEpochSecond() / TOTP_STEP_SECONDS;
        for (int offset = -1; offset <= 1; offset++) {
            String candidate = totpAt(secret, counter + offset);
            if (candidate != null && MessageDigest.isEqual(
                candidate.getBytes(StandardCharsets.UTF_8), code.getBytes(StandardCharsets.UTF_8))) {
                return true;
            }
        }
        return false;
    }

    private String totpAt(String secret, long counter) {
        try {
            byte[] key = base32Decode(secret);
            byte[] data = new byte[8];
            long value = counter;
            for (int index = 7; index >= 0; index--) {
                data[index] = (byte) (value & 0xff);
                value >>= 8;
            }
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] digest = mac.doFinal(data);
            int offset = digest[digest.length - 1] & 0x0f;
            int binary = ((digest[offset] & 0x7f) << 24)
                | ((digest[offset + 1] & 0xff) << 16)
                | ((digest[offset + 2] & 0xff) << 8)
                | (digest[offset + 3] & 0xff);
            int code = binary % (int) Math.pow(10, TOTP_DIGITS);
            return String.format("%0" + TOTP_DIGITS + "d", code);
        } catch (Exception exception) {
            return null;
        }
    }

    private String hashBackupCode(String code) {
        String normalized = code == null ? "" : code.trim().toUpperCase().replaceAll("\\s+", "");
        return sha256(normalized);
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private String qrDataUrl(String uri) {
        try {
            Map<EncodeHintType, Object> hints = Map.of(EncodeHintType.MARGIN, 1);
            var matrix = new QRCodeWriter().encode(uri, BarcodeFormat.QR_CODE, 220, 220, hints);
            BufferedImage image = new BufferedImage(matrix.getWidth(), matrix.getHeight(), BufferedImage.TYPE_INT_RGB);
            for (int y = 0; y < matrix.getHeight(); y++) {
                for (int x = 0; x < matrix.getWidth(); x++) {
                    image.setRGB(x, y, matrix.get(x, y) ? 0x1f2925 : 0xffffff);
                }
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            ImageIO.write(image, "png", output);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(output.toByteArray());
        } catch (Exception exception) {
            return null;
        }
    }

    public String encryptSecret(String plaintext) {
        return encrypt(plaintext);
    }

    public String decryptSecret(String payload) {
        return decrypt(payload);
    }

    private String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(128, iv));
            byte[] output = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = java.util.Arrays.copyOfRange(output, 0, output.length - 16);
            byte[] tag = java.util.Arrays.copyOfRange(output, output.length - 16, output.length);
            Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
            return encoder.encodeToString(iv) + "." + encoder.encodeToString(tag) + "."
                + encoder.encodeToString(encrypted);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not encrypt the MFA secret.", exception);
        }
    }

    private String decrypt(String payload) {
        try {
            String[] parts = payload.split("\\.");
            if (parts.length != 3) return payload;
            Base64.Decoder decoder = Base64.getUrlDecoder();
            byte[] iv = decoder.decode(parts[0]);
            byte[] tag = decoder.decode(parts[1]);
            byte[] data = decoder.decode(parts[2]);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(128, iv));
            byte[] combined = new byte[data.length + tag.length];
            System.arraycopy(data, 0, combined, 0, data.length);
            System.arraycopy(tag, 0, combined, data.length, tag.length);
            return new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            return payload;
        }
    }

    private byte[] key() {
        if (encryptionKey != null) return encryptionKey;
        synchronized (this) {
            if (encryptionKey != null) return encryptionKey;
            try {
                Path path = Path.of(keyFile);
                if (Files.exists(path)) {
                    encryptionKey = Base64.getDecoder().decode(Files.readString(path).trim());
                } else {
                    Path parent = path.getParent();
                    if (parent != null) Files.createDirectories(parent);
                    byte[] generated = new byte[32];
                    RANDOM.nextBytes(generated);
                    Files.writeString(path, Base64.getEncoder().encodeToString(generated));
                    encryptionKey = generated;
                }
                return encryptionKey;
            } catch (Exception exception) {
                throw new IllegalStateException("Could not load the MFA encryption key.", exception);
            }
        }
    }

    private String urlEncode(String value) {
        return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            return "[]";
        }
    }

    private String randomToken(int bytes) {
        byte[] data = new byte[bytes];
        RANDOM.nextBytes(data);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private int number(Object value) {
        if (value instanceof Number number) return number.intValue();
        if (value instanceof Boolean bool) return bool ? 1 : 0;
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception exception) {
            return 0;
        }
    }

    private record Challenge(String userId, Instant expiresAt) {
    }
}
