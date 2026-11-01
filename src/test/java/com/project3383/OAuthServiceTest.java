package com.project3383;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.project3383.app.OAuthService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OAuthServiceTest {

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void githubExchangeReadsVerifiedPrimaryEmail() throws Exception {
        startServer(Map.of(
            "/token", "{\"access_token\":\"gh-token\"}",
            "/user", "{\"id\":123,\"login\":\"octocat\",\"name\":null,\"email\":null}",
            "/emails", "[{\"email\":\"octo@example.com\",\"primary\":true,\"verified\":true}]"
        ));
        MockEnvironment environment = environment()
            .withProperty("GITHUB_CLIENT_ID", "github-client")
            .withProperty("GITHUB_CLIENT_SECRET", "github-secret")
            .withProperty("OAUTH_GITHUB_TOKEN_URL", url("/token"))
            .withProperty("OAUTH_GITHUB_USER_URL", url("/user"))
            .withProperty("OAUTH_GITHUB_EMAILS_URL", url("/emails"));

        OAuthService.Profile profile = new OAuthService(environment, new ObjectMapper())
            .exchange("github", "http://localhost:3383", "code");

        assertEquals("123", profile.providerAccountId());
        assertEquals("octo@example.com", profile.email());
        assertEquals("octocat", profile.name());
    }

    @Test
    void googleExchangeRequiresVerifiedEmail() throws Exception {
        startServer(Map.of(
            "/token", "{\"access_token\":\"google-token\"}",
            "/userinfo", "{\"sub\":\"google-1\",\"email\":\"person@example.com\","
                + "\"email_verified\":true,\"name\":\"Person Name\"}"
        ));
        MockEnvironment environment = environment()
            .withProperty("GOOGLE_CLIENT_ID", "google-client")
            .withProperty("GOOGLE_CLIENT_SECRET", "google-secret")
            .withProperty("OAUTH_GOOGLE_TOKEN_URL", url("/token"))
            .withProperty("OAUTH_GOOGLE_USERINFO_URL", url("/userinfo"));

        OAuthService.Profile profile = new OAuthService(environment, new ObjectMapper())
            .exchange("google", "http://localhost:3383", "code");

        assertEquals("google-1", profile.providerAccountId());
        assertEquals("person@example.com", profile.email());
        assertEquals("Person Name", profile.name());
    }

    @Test
    void appleExchangeVerifiesJwksSignatureAndClaims() throws Exception {
        RSAKey key = new RSAKeyGenerator(2048).keyID("apple-key-1").generate();
        String idToken = appleToken(key, "apple-client");
        String jwks = new ObjectMapper().writeValueAsString(new JWKSet(key.toPublicJWK()).toJSONObject());
        startServer(Map.of(
            "/token", "{\"id_token\":\"" + idToken + "\"}",
            "/keys", jwks
        ));
        MockEnvironment environment = environment()
            .withProperty("APPLE_CLIENT_ID", "apple-client")
            .withProperty("APPLE_CLIENT_SECRET", "apple-secret")
            .withProperty("OAUTH_APPLE_TOKEN_URL", url("/token"))
            .withProperty("OAUTH_APPLE_JWKS_URL", url("/keys"));

        OAuthService.Profile profile = new OAuthService(environment, new ObjectMapper())
            .exchange("apple", "http://localhost:3383", "code");

        assertEquals("apple-user-1", profile.providerAccountId());
        assertEquals("apple@example.com", profile.email());
    }

    @Test
    void appleExchangeRejectsATokenSignedByAnotherKey() throws Exception {
        RSAKey trusted = new RSAKeyGenerator(2048).keyID("apple-key-1").generate();
        RSAKey attacker = new RSAKeyGenerator(2048).keyID("apple-key-1").generate();
        String idToken = appleToken(attacker, "apple-client");
        String jwks = new ObjectMapper().writeValueAsString(new JWKSet(trusted.toPublicJWK()).toJSONObject());
        startServer(Map.of(
            "/token", "{\"id_token\":\"" + idToken + "\"}",
            "/keys", jwks
        ));
        MockEnvironment environment = environment()
            .withProperty("APPLE_CLIENT_ID", "apple-client")
            .withProperty("APPLE_CLIENT_SECRET", "apple-secret")
            .withProperty("OAUTH_APPLE_TOKEN_URL", url("/token"))
            .withProperty("OAUTH_APPLE_JWKS_URL", url("/keys"));

        OAuthService service = new OAuthService(environment, new ObjectMapper());
        assertThrows(IllegalStateException.class,
            () -> service.exchange("apple", "http://localhost:3383", "code"));
    }

    private MockEnvironment environment() {
        return new MockEnvironment();
    }

    private String appleToken(RSAKey key, String clientId) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer("https://appleid.apple.com")
            .audience(clientId)
            .subject("apple-user-1")
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .claim("email", "apple@example.com")
            .claim("email_verified", true)
            .build();
        SignedJWT jwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }

    private String url(String path) {
        return "http://127.0.0.1:" + server.getAddress().getPort() + path;
    }

    private void startServer(Map<String, String> responses) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (Map.Entry<String, String> entry : responses.entrySet()) {
            server.createContext(entry.getKey(), exchange -> respond(exchange, entry.getValue()));
        }
        server.start();
    }

    private void respond(HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("content-type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
