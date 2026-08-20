import OpenAI from "openai";

const client = new OpenAI();

export async function createAssistant() {
  const assistant = await client.beta.assistants.create({
    name: "Support Bot",
    instructions: "You are helpful.",
    model: "gpt-4o",
  });
  return assistant.id;
}

export async function runThread(assistantId, userMessage) {
  const thread = await client.beta.threads.create();
  await client.beta.threads.messages.create(thread.id, {
    role: "user",
    content: userMessage,
  });
  const run = await client.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });
  return { thread_id: thread.id, run_id: run.id };
}
