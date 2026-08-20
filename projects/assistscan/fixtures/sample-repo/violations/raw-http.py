import requests

OPENAI_API_KEY = "sk-test"
ASSISTANT_ID = "asst_abc123"

def create_thread():
    return requests.post(
        "https://api.openai.com/v1/threads",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={},
    ).json()

def poll_run(thread_id):
    url = f"https://api.openai.com/v1/threads/{thread_id}/runs/run_123"
    return requests.get(url, headers={"Authorization": f"Bearer {OPENAI_API_KEY}"})

def list_assistants():
    return requests.get(
        "https://api.openai.com/v1/assistants",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
    )
