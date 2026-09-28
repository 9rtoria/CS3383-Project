package com.example.kanbanplanner;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class StaticResourceTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void rootPathServesIndexHtml() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("index.html"));
    }

    @Test
    void indexHtmlPathServesIndexFile() throws Exception {
        mockMvc.perform(get("/index.html"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
                .andExpect(content().string(containsString("Kanban Planner")));
    }

    @Test
    void indexHtmlIncludesTabsBoardGridAndTaskDrawerContainers() throws Exception {
        mockMvc.perform(get("/index.html"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("id=\"tab-board\"")))
                .andExpect(content().string(containsString("id=\"tab-grid\"")))
                .andExpect(content().string(containsString("id=\"tab-charts\"")))
                .andExpect(content().string(containsString("id=\"board-columns\"")))
                .andExpect(content().string(containsString("id=\"grid-section\"")))
                .andExpect(content().string(containsString("id=\"grid-table\"")))
                .andExpect(content().string(containsString("id=\"task-drawer\"")))
                .andExpect(content().string(containsString("id=\"task-details-form\"")))
                .andExpect(content().string(containsString("id=\"show-create-plan-button\"")))
                .andExpect(content().string(containsString("id=\"open-create-task-button\"")));
    }

    @Test
    void unknownStaticPathReturnsNotFound() throws Exception {
        mockMvc.perform(get("/does-not-exist"))
                .andExpect(status().isNotFound());
    }
}
