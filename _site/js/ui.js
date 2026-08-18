(function (document, window) {
    'use strict';

    var root = document.documentElement;
    var STORAGE_KEY = 'theme';

    function systemTheme() {
        return window.matchMedia &&
               window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    function currentTheme() {
        return root.getAttribute('data-theme') || systemTheme();
    }

    function setTheme(theme) {
        root.setAttribute('data-theme', theme);
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {}
    }

    var toggle = document.getElementById('themeToggle');

    if (toggle) {
        toggle.addEventListener('click', function () {
            setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        });
    }

    // Follow the OS until the reader makes an explicit choice.
    if (window.matchMedia) {
        var query = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function (event) {
            var stored;
            try {
                stored = window.localStorage.getItem(STORAGE_KEY);
            } catch (e) {}

            if (stored !== 'light' && stored !== 'dark') {
                root.setAttribute('data-theme', event.matches ? 'dark' : 'light');
            }
        };

        if (query.addEventListener) {
            query.addEventListener('change', onChange);
        } else if (query.addListener) {
            query.addListener(onChange);
        }
    }
}(document, window));
