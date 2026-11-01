package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private final AppService appService;

    public AccountController(AppService appService) {
        this.appService = appService;
    }

    @PatchMapping
    public Map<String, Object> update(HttpSession session, @RequestBody ApiDtos.AccountUpdate input) {
        return appService.updateAccount(CurrentUser.id(session), input);
    }
}
