package com.project3383.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SharePageController {

    @GetMapping("/share/{token}")
    public String sharedBoardPage() {
        return "forward:/share.html";
    }
}
