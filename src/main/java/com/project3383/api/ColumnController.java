package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/columns")
public class ColumnController {

    private final AppService appService;

    public ColumnController(AppService appService) {
        this.appService = appService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpSession session, @RequestBody ApiDtos.ColumnCreate input) {
        return appService.createColumn(CurrentUser.id(session), input);
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(HttpSession session, @PathVariable String id,
                                      @RequestBody ApiDtos.ColumnUpdate input) {
        return appService.updateColumn(CurrentUser.id(session), id, input);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpSession session, @PathVariable String id,
                                      @RequestParam String workspaceId) {
        return appService.deleteColumn(CurrentUser.id(session), id, workspaceId);
    }

    @PutMapping("/reorder")
    public Map<String, Object> reorder(HttpSession session, @RequestBody ApiDtos.ColumnReorder input) {
        return appService.reorderColumns(CurrentUser.id(session), input);
    }
}
