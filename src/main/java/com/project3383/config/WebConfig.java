package com.project3383.config;

import com.project3383.api.IdempotencyInterceptor;
import com.project3383.auth.AuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final IdempotencyInterceptor idempotencyInterceptor;

    public WebConfig(AuthInterceptor authInterceptor, IdempotencyInterceptor idempotencyInterceptor) {
        this.authInterceptor = authInterceptor;
        this.idempotencyInterceptor = idempotencyInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/auth/**", "/api/health", "/api/share/**",
                "/api/metrics", "/api/client-errors", "/api/openapi");
        registry.addInterceptor(idempotencyInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/auth/**", "/api/health", "/api/share/**",
                "/api/metrics", "/api/client-errors", "/api/openapi");
    }
}
