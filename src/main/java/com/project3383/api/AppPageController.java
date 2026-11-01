package com.project3383.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class AppPageController {

    @GetMapping("/settings")
    public String settingsPage() {
        return "forward:/index.html";
    }

    @GetMapping("/offline")
    public String offlinePage() {
        return "forward:/offline.html";
    }

    @GetMapping("/invite/{token}")
    public String invitePage() {
        return "forward:/invite.html";
    }
}
