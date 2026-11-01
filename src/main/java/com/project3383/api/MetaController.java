package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.AuthInterceptor;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class MetaController {

    private final AppService appService;

    public MetaController(AppService appService) {
        this.appService = appService;
    }

    @GetMapping("/labels")
    public Map<String, Object> labels(HttpSession session, @RequestParam String workspaceId) {
        return appService.labels(CurrentUser.id(session), workspaceId);
    }

    @PostMapping("/labels")
    public Map<String, Object> createLabel(HttpSession session, @RequestBody ApiDtos.LabelCreate input) {
        return appService.createLabel(CurrentUser.id(session), input);
    }

    @DeleteMapping("/labels")
    public Map<String, Object> deleteLabel(HttpSession session, @RequestBody ApiDtos.LabelDelete input) {
        return appService.deleteLabel(CurrentUser.id(session), input);
    }

    @GetMapping("/views")
    public Map<String, Object> views(HttpSession session, @RequestParam String workspaceId) {
        return appService.views(CurrentUser.id(session), workspaceId);
    }

    @PostMapping("/views")
    public Map<String, Object> createView(HttpSession session, @RequestBody ApiDtos.ViewCreate input) {
        return appService.createView(CurrentUser.id(session), input);
    }

    @DeleteMapping("/views")
    public Map<String, Object> deleteView(HttpSession session, @RequestBody ApiDtos.ViewDelete input) {
        return appService.deleteView(CurrentUser.id(session), input);
    }

    @GetMapping("/workspaces")
    public Map<String, Object> workspaces(HttpSession session) {
        return appService.workspaces(CurrentUser.id(session));
    }

    @GetMapping("/metrics")
    public Map<String, Object> metrics(HttpServletRequest request,
                                       @RequestParam(required = false) String workspaceId) {
        HttpSession session = request.getSession(false);
        Object userId = session == null ? null : session.getAttribute(AuthInterceptor.SESSION_USER);
        return appService.metrics(userId == null ? null : userId.toString(), workspaceId);
    }

    @PostMapping("/client-errors")
    public ResponseEntity<Map<String, Object>> clientError(HttpServletRequest request,
                                                           @RequestBody ApiDtos.ClientErrorCreate input) {
        if (input == null || input.message() == null || input.message().isBlank()) {
            throw ApiException.badRequest("An error message is required.");
        }
        HttpSession session = request.getSession(false);
        Object userId = session == null ? null : session.getAttribute(AuthInterceptor.SESSION_USER);
        Object requestId = request.getAttribute("project3383.requestId");
        appService.clientError(userId == null ? null : userId.toString(), input.message(), input.stack(),
            input.url(), request.getHeader("User-Agent"), requestId == null ? null : requestId.toString());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("received", true));
    }

    @GetMapping("/openapi")
    public ResponseEntity<String> openApi() throws IOException {
        ClassPathResource resource = new ClassPathResource("openapi.yaml");
        if (!resource.exists()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "OpenAPI description is not installed in this build.");
        }
        String body = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/yaml; charset=utf-8"))
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
            .body(body);
    }
}
