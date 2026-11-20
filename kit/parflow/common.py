import json
import os


def load_config():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")) as f:
        return json.load(f)


def register_hydroframe():
    """Register your HydroFrame API PIN (needed once per machine / 2 days).

    Set HF_EMAIL and HF_PIN environment variables, or run
    hf_hydrodata.register_api_pin("you@example.com", "1234") yourself first.
    """
    import hf_hydrodata as hf
    email, pin = os.environ.get("HF_EMAIL"), os.environ.get("HF_PIN")
    if email and pin:
        hf.register_api_pin(email, pin)
    else:
        print("HF_EMAIL / HF_PIN not set - assuming your PIN is already registered.")


# Dataset names in the HydroFrame catalog for each national ParFlow grid
DATASETS = {
    "conus2": {"domain": "conus2_domain", "baseline": "conus2_baseline", "forcing": "CW3E"},
    "conus1": {"domain": "conus1_domain", "baseline": "conus1_baseline_mod", "forcing": "NLDAS2"},
}
