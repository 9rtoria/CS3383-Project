package com.project3383.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class AuthPageController {

    @GetMapping("/auth")
    public String authPage() {
        return "forward:/auth.html";
    }
}
