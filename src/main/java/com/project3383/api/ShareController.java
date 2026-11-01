package com.project3383.api;

import com.project3383.app.AppService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class ShareController {

    private final AppService appService;

    public ShareController(AppService appService) {
        this.appService = appService;
    }

    @GetMapping("/api/share/{token}")
    public Map<String, Object> sharedBoard(@PathVariable String token) {
        return appService.publicBoard(token);
    }
}
