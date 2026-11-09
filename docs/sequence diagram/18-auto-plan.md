# SD18 — Auto-plan Preview / Apply / Clear

**Covers:** `AutoPlanController.run` → `AutoPlanService.preview / apply / clear / blocksForDate`,
undo via `AutoPlanService.undo`.

Source: `app/AutoPlanService.java`.

`apply` calls `preview` internally (reuse — the lecture's `ref` concept) and supports a *safe*
mode that treats existing auto blocks as fixed. Undo is handled through `UndoService`.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :AutoPlanController
    participant P as :AutoPlanService
    participant DB as :JdbcTemplate

    Note over U,DB: action = "preview"
    U->>B: open Auto-plan
    B->>C: POST /api/auto-plan {action:"preview", workspaceId}
    C->>P: preview(userId, workspaceId)
    P->>P: requireMembership
    P->>DB: SELECT settings, tasks, capacity, plan_block
    alt auto-plan disabled
        P-->>C: {enabled:false, options:[], startDate, horizonDays, weeklyCapacityMinutes, generatedAt}
    else enabled
        P->>P: option("balanced"/"focus"/"light") each → blocks[]
        P-->>C: {enabled:true, options:[...], startDate, horizonDays, weeklyCapacityMinutes, generatedAt}
    end
    C-->>B: options rendered

    Note over U,DB: action = "apply"
    U->>B: choose an option → Apply
    B->>C: POST /api/auto-plan {action:"apply", optionId, safe}
    C->>P: apply(userId, workspaceId, optionId, safe, delegated)
    P->>P: preview(...)  (ref reuse)
    P->>DB: SELECT previous auto plan_block (source='auto', unlocked)
    opt safe mode
        P->>P: recompute option with existing blocks fixed, filter out overlapping
        opt no new blocks
            P-->>C: {applied:0, appliedBlocks:0, optionId, undoId:null, archived:0, planBlocks:[...]} (no undo row)
        end
    end
    P->>DB: DELETE old auto plan_block (source='auto', locked=0) in horizon (safe mode: selected tasks only)
    P->>DB: DELETE today_selection for start date (non-safe mode)
    P->>DB: INSERT plan_block(source='auto') for proposed blocks
    P->>DB: INSERT OR IGNORE today_selection for blocks landing today
    P->>DB: UPDATE task.focus_date (clear range, then set for today's tasks)
    opt delegated && mode='delegated' && allow_stale_archive
        P->>DB: UPDATE stale tasks (no due/focus, old) SET archived_at=now
    end
    P->>DB: INSERT undo_action("auto_plan.apply", {previousBlocks,Selections,Focus,Archived}, ttl 300s)
    P-->>C: {applied:<int>, appliedBlocks:<int>, optionId, undoId, archived:<int>, planBlocks:[...]}
    C-->>B: day flow updated

    Note over U,DB: action = "clear"
    B->>C: POST /api/auto-plan {action:"clear"}
    C->>P: clear(userId, workspaceId)
    P->>DB: DELETE plan_block WHERE source='auto' AND locked=0 AND date in horizon
    P-->>C: {cleared:<int count deleted>}
```
