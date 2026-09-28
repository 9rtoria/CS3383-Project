package com.example.kanbanplanner.controller;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.dto.PlannerDtoMapper;
import com.example.kanbanplanner.dto.request.BucketUpsertRequest;
import com.example.kanbanplanner.dto.response.BucketResponse;
import com.example.kanbanplanner.service.BucketService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/plans/{planId}/buckets")
public class BucketController {

    private final BucketService bucketService;
    private final PlannerDtoMapper mapper;

    public BucketController(BucketService bucketService, PlannerDtoMapper mapper) {
        this.bucketService = bucketService;
        this.mapper = mapper;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BucketResponse createBucket(@PathVariable String planId, @RequestBody BucketUpsertRequest request) {
        Bucket created = bucketService.createBucket(planId, request.name());
        return mapper.toBucketResponse(created);
    }

    @PutMapping("/{bucketId}")
    public BucketResponse renameBucket(
            @PathVariable String planId,
            @PathVariable String bucketId,
            @RequestBody BucketUpsertRequest request) {
        Bucket updated = bucketService.renameBucket(planId, bucketId, request.name());
        return mapper.toBucketResponse(updated);
    }

    @DeleteMapping("/{bucketId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteBucket(@PathVariable String planId, @PathVariable String bucketId) {
        bucketService.deleteBucket(planId, bucketId);
    }
}
