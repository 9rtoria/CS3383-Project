package com.project3383.api;

import com.project3383.app.UndoService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/undo")
public class UndoController {

    private final UndoService undoService;

    public UndoController(UndoService undoService) {
        this.undoService = undoService;
    }

    @PostMapping("/{id}")
    public Map<String, Object> undo(HttpSession session, @PathVariable String id) {
        return undoService.undo(CurrentUser.id(session), id);
    }
}
