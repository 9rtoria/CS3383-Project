"use strict";

const THEME_STORAGE_KEY = "kanban-theme";
const THEMES = {
    light: "light",
    dark: "dark"
};

export function createThemeToggle(options) {
    const {
        state,
        onNotice
    } = options;

    const button = document.getElementById("theme-toggle-button");
    const label = document.getElementById("theme-toggle-label");

    function currentTheme() {
        return document.documentElement.dataset.theme === THEMES.dark ? THEMES.dark : THEMES.light;
    }

    function apply(theme) {
        if (theme === THEMES.dark) {
            document.documentElement.dataset.theme = THEMES.dark;
        } else {
            delete document.documentElement.dataset.theme;
        }
        if (state) {
            state.theme = theme;
        }
        updateButton(theme);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (error) {
            // Storage may be unavailable; theme still applies for this session.
        }
    }

    function updateButton(theme) {
        const isDark = theme === THEMES.dark;
        if (button) {
            button.setAttribute("aria-pressed", String(isDark));
            button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
        }
        if (label) {
            label.textContent = isDark ? "Light mode" : "Dark mode";
        }
    }

    function toggle() {
        const next = currentTheme() === THEMES.dark ? THEMES.light : THEMES.dark;
        apply(next);
        if (onNotice) {
            onNotice(next === THEMES.dark ? "Dark mode" : "Light mode");
        }
    }

    if (button) {
        button.addEventListener("click", toggle);
    }

    apply(currentTheme());

    return {
        apply,
        toggle,
        currentTheme
    };
}