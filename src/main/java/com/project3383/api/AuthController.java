package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AppService appService;

    public AuthController(AppService appService) {
        this.appService = appService;
    }

    @PostMapping("/guest")
    public Map<String, Object> guest(HttpSession session) {
        Object existing = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (existing != null) {
            return appService.bootstrap(existing.toString());
        }
        Map<String, Object> boot = appService.createGuest();
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) boot.get("user");
        session.setAttribute(AuthInterceptor.SESSION_USER, user.get("id"));
        return boot;
    }

    @PostMapping("/signup")
    public Map<String, Object> signup(HttpServletRequest request, HttpSession session, @RequestBody ApiDtos.Signup input) {
        Object current = session.getAttribute(AuthInterceptor.SESSION_USER);
        AppService.AuthResult result = appService.signup(current == null ? null : current.toString(), input);
        if (request.getSession(false) != null) request.changeSessionId();
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        return result.bootstrap();
    }

    @PostMapping("/signin")
    public Map<String, Object> signin(HttpServletRequest request, @RequestBody ApiDtos.Signin input) {
        AppService.AuthResult result = appService.signin(input);
        HttpSession old = request.getSession(false);
        if (old != null) old.invalidate();
        HttpSession session = request.getSession(true);
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        return result.bootstrap();
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpSession session) {
        Object userId = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (userId == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "No session.");
        return appService.bootstrap(userId.toString());
    }

    @DeleteMapping("/signout")
    public Map<String, Object> signOut(HttpSession session) {
        session.invalidate();
        return Map.of("signedOut", true);
    }
}
