package com.example.kanbanplanner.controller;

import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.dto.PlannerDtoMapper;
import com.example.kanbanplanner.dto.request.PlanUpsertRequest;
import com.example.kanbanplanner.dto.response.PlanDetailResponse;
import com.example.kanbanplanner.dto.response.PlanSummaryResponse;
import com.example.kanbanplanner.service.PlanService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/plans")
public class PlanController {

    private final PlanService planService;
    private final PlannerDtoMapper mapper;

    public PlanController(PlanService planService, PlannerDtoMapper mapper) {
        this.planService = planService;
        this.mapper = mapper;
    }

    @GetMapping
    public List<PlanSummaryResponse> listPlans() {
        return planService.listPlans().stream()
                .map(mapper::toPlanSummaryResponse)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PlanDetailResponse createPlan(@RequestBody PlanUpsertRequest request) {
        Plan created = planService.createPlan(request.name());
        return mapper.toPlanDetailResponse(created);
    }

    @GetMapping("/{planId}")
    public PlanDetailResponse getPlan(@PathVariable String planId) {
        return mapper.toPlanDetailResponse(planService.getPlan(planId));
    }

    @PutMapping("/{planId}")
    public PlanDetailResponse updatePlan(@PathVariable String planId, @RequestBody PlanUpsertRequest request) {
        Plan updated = planService.renamePlan(planId, request.name());
        return mapper.toPlanDetailResponse(updated);
    }

    @DeleteMapping("/{planId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePlan(@PathVariable String planId) {
        planService.deletePlan(planId);
    }
}
