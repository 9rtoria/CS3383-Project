package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/subtasks")
public class SubtaskController {

    private final AppService appService;

    public SubtaskController(AppService appService) {
        this.appService = appService;
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(HttpSession session, @PathVariable String id, @RequestBody ApiDtos.SubtaskUpdate input) {
        return appService.updateSubtask(CurrentUser.id(session), id, input);
    }
}
