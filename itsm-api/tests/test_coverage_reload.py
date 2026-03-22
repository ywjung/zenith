"""Coverage for module-level exception fallback paths.

These lines are only reachable when optional packages are unavailable at
import time.  We cover them by temporarily hiding packages in sys.modules,
re-importing / reloading the affected module, then fully restoring state.
"""
import importlib
import sys
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# rate_limit.py:81-82  — inner except Exception inside the slowapi fallback
# ---------------------------------------------------------------------------

def test_rate_limit_inner_except_when_get_settings_raises():
    """slowapi unavailable + get_settings raises → rate_limit.py lines 81-82.

    Structure in rate_limit.py:
        except Exception as _e:           # outer — catches missing slowapi
            try:
                _gs().ENVIRONMENT ...
            except Exception:             # line 81
                pass                      # line 82
    """
    # --- save ---
    original_rl = sys.modules.get("app.rate_limit")
    slowapi_keys = [k for k in sys.modules if k == "slowapi" or k.startswith("slowapi.")]
    saved_slowapi = {k: sys.modules[k] for k in slowapi_keys}

    try:
        # Hide slowapi so the outer try block raises Exception
        for k in slowapi_keys:
            sys.modules[k] = None  # type: ignore[assignment]
        if "slowapi" not in sys.modules:
            sys.modules["slowapi"] = None  # type: ignore[assignment]

        # Remove the cached module so the fresh import re-runs module-level code
        sys.modules.pop("app.rate_limit", None)

        # Make get_settings raise so lines 81-82 are reached
        with patch("app.config.get_settings", side_effect=RuntimeError("no config")):
            import app.rate_limit as rl_fresh

        assert rl_fresh.limiter is None

    finally:
        # Restore slowapi entries
        for k in list(sys.modules.keys()):
            if (k == "slowapi" or k.startswith("slowapi.")) and sys.modules[k] is None:
                if k in saved_slowapi:
                    sys.modules[k] = saved_slowapi[k]
                else:
                    del sys.modules[k]
        # Also restore any that were not None but we saved
        for k, v in saved_slowapi.items():
            sys.modules[k] = v
        # Restore original rate_limit module
        if original_rl is not None:
            sys.modules["app.rate_limit"] = original_rl
        elif "app.rate_limit" in sys.modules:
            del sys.modules["app.rate_limit"]


# ---------------------------------------------------------------------------
# main.py:353-354, 626-627, 634-635  — three except blocks for optional deps
# ---------------------------------------------------------------------------

def test_main_optional_dep_fallback_paths():
    """Reload app.main with three optional packages broken.

    Covers:
      353-354 : except Exception   (slowapi setup)
      626-627 : except ImportError (prometheus)
      634-635 : except Exception   (business_metrics start)
    """
    original_main = sys.modules.get("app.main")

    # Packages to temporarily disable
    keys_to_null = [
        "slowapi",          # triggers line 353-354
        "prometheus_fastapi_instrumentator",   # triggers line 626-627
    ]
    saved = {k: sys.modules.get(k) for k in keys_to_null}

    try:
        for k in keys_to_null:
            sys.modules[k] = None  # type: ignore[assignment]

        # Make start_background_refresh raise → triggers line 634-635
        with patch(
            "app.business_metrics.start_background_refresh",
            side_effect=RuntimeError("bm init failed"),
        ):
            importlib.reload(sys.modules["app.main"])

    finally:
        # Restore disabled packages
        for k, v in saved.items():
            if v is None and k in sys.modules and sys.modules[k] is None:
                del sys.modules[k]
            elif v is not None:
                sys.modules[k] = v
        # Always restore the original app.main module so other tests are unaffected
        if original_main is not None:
            sys.modules["app.main"] = original_main
