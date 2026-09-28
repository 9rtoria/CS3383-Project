"use strict";

import {planApi} from "./api.js";
import {createAppState} from "./state.js";
import {createPlansView} from "./views/plans.js";

document.addEventListener("DOMContentLoaded", () => {
    const state = createAppState();

    const view = createPlansView({
        state,
        planApi,
        onStateChange: () => {
        }
    });

    view.render();
    view.refreshPlans();
});
