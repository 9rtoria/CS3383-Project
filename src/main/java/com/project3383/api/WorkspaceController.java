package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class WorkspaceController {

    private final AppService appService;

    public WorkspaceController(AppService appService) {
        this.appService = appService;
    }

    @DeleteMapping
    public Map<String, Object> delete(HttpSession session, @PathVariable String workspaceId) {
        return appService.deleteWorkspace(CurrentUser.id(session), workspaceId);
    }

    @GetMapping("/members")
    public Map<String, Object> members(HttpSession session, @PathVariable String workspaceId) {
        return appService.members(CurrentUser.id(session), workspaceId);
    }

    @PostMapping("/invites")
    public Map<String, Object> invite(HttpSession session, @PathVariable String workspaceId, @RequestBody ApiDtos.InviteCreate input) {
        return appService.invite(CurrentUser.id(session), workspaceId, input);
    }

    @PatchMapping("/members/{userId}")
    public Map<String, Object> role(HttpSession session, @PathVariable String workspaceId, @PathVariable String userId, @RequestBody ApiDtos.MemberRole input) {
        return appService.changeRole(CurrentUser.id(session), workspaceId, userId, input == null ? null : input.role());
    }

    @DeleteMapping("/members/{userId}")
    public Map<String, Object> remove(HttpSession session, @PathVariable String workspaceId, @PathVariable String userId) {
        return appService.removeMember(CurrentUser.id(session), workspaceId, userId);
    }
}
