package com.project3383.api;

import com.project3383.app.DataService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class DataController {

    private final DataService dataService;

    public DataController(DataService dataService) {
        this.dataService = dataService;
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(HttpSession session,
                                         @RequestParam String workspaceId,
                                         @RequestParam(required = false) String format) {
        DataService.ExportFile file = dataService.export(CurrentUser.id(session), workspaceId, format);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(file.contentType()));
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file.filename() + "\"");
        headers.setCacheControl("no-store");
        return ResponseEntity.ok().headers(headers).body(file.body());
    }

    @PostMapping("/import")
    public Map<String, Object> importData(HttpSession session, @RequestBody ApiDtos.ImportRequest input) {
        return dataService.importData(CurrentUser.id(session), input);
    }
}
