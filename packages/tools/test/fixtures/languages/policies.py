from fastapi import FastAPI
app = FastAPI()

class PolicyService:
    def find(self, policy_id: str):
        return None

@app.get("/policies/{policy_id}")
async def get_policy(policy_id: str):
    return PolicyService().find(policy_id)
