// Clean Responses API usage — should pass.
import OpenAI from "openai";

const client = new OpenAI();

export async function ask(userText, previousResponseId) {
  const response = await client.responses.create({
    model: "gpt-4.1",
    input: userText,
    previous_response_id: previousResponseId,
  });
  return response;
}
