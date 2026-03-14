import { DurableObject } from "cloudflare:workers";

interface Env {
    AI: Ai;
    CHAT_SESSION: DurableObjectNamespace<ChatSession>;
}

type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export class ChatSession extends DurableObject {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/history" && request.method === "GET") {
            const history =
                ((await this.ctx.storage.get("messages")) as ChatMessage[] | undefined) || [];

            return new Response(JSON.stringify({ messages: history }), {
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders,
                },
            });
        }

        if (url.pathname === "/append" && request.method === "POST") {
            const body = (await request.json()) as { message: ChatMessage };
            const history =
                ((await this.ctx.storage.get("messages")) as ChatMessage[] | undefined) || [];

            history.push(body.message);
            await this.ctx.storage.put("messages", history);

            return new Response(JSON.stringify({ ok: true, messages: history }), {
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders,
                },
            });
        }

        if (url.pathname === "/reset" && request.method === "POST") {
            await this.ctx.storage.delete("messages");
            return new Response(JSON.stringify({ ok: true }), {
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders,
                },
            });
        }

        return new Response("Not Found", {
            status: 404,
            headers: corsHeaders,
        });
    }
}

async function runPlanner(env: Env, userMessage: string): Promise<any> {
    const plannerPrompt = `
You are a planning module for an AI job application assistant.

Analyze the user's request and return ONLY valid JSON.

Return exactly this schema:
{
  "taskType": "resume_rewrite" | "interview_prep" | "jd_analysis" | "general",
  "keyTopics": ["topic1", "topic2"],
  "steps": ["step1", "step2", "step3"],
  "executionPrompt": "clear instructions for the final AI call"
}

Rules:
- Output JSON only
- Do not use markdown
- Do not use code fences
- steps must be short user-visible progress messages
- keyTopics must be concise technical themes
- taskType must be one of the allowed values
`;

    const result = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
            messages: [
                { role: "system", content: plannerPrompt },
                { role: "user", content: userMessage }
            ],
            temperature: 0
        }
    );

    console.log("PLANNER RAW RESULT:", JSON.stringify(result, null, 2));

    const response = (result as any).response;

    if (response && typeof response === "object" && !Array.isArray(response)) {
        return response;
    }

    if (typeof response === "string") {
        try {
            return JSON.parse(response);
        } catch {
            const cleaned = response
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            try {
                return JSON.parse(cleaned);
            } catch {
                // fall through
            }
        }
    }

    return {
        taskType: "general",
        keyTopics: [],
        steps: ["Analyzing request", "Generating response"],
        executionPrompt: "Answer the user's request helpfully."
    };
}


export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }

        if (url.pathname === "/") {
            return new Response("PrepForge AI Worker running 🚀", {
                headers: corsHeaders,
            });
        }

        if (url.pathname === "/chat/stream" && request.method === "POST") {

            const body = (await request.json()) as {
                message: string;
                mode?: string;
                sessionId?: string;
            };

            const message = body.message?.trim() || "";
            const sessionId = body.sessionId?.trim() || "default";
            const stream = new ReadableStream({
                async start(controller) {

                    const encoder = new TextEncoder();

                    const sendEvent = (type: string, data: any) => {
                        controller.enqueue(
                            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
                        );
                    };

                    try {

                        sendEvent("step", { message: "Planning request..." });

                        const plan = await runPlanner(env, message);

                        sendEvent("plan", plan);

                        sendEvent("step", { message: "Generating response..." });

                        const result = await env.AI.run(
                            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                            {
                                messages: [
                                    {
                                        role: "system",
                                        content: plan.executionPrompt
                                    },
                                    {
                                        role: "user",
                                        content: message
                                    }
                                ]
                            }
                        );

                        const finalResponse =
                            typeof (result as any).response === "string"
                                ? (result as any).response
                                : JSON.stringify((result as any).response);

                        sendEvent("final", { response: finalResponse });

                        controller.close();

                    } catch (err) {

                        sendEvent("error", { message: "Agent failed" });

                        controller.close();
                    }
                }
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        if (url.pathname === "/chat" && request.method === "POST") {
            try {
                const body = (await request.json()) as {
                    message: string;
                    mode?: string;
                    sessionId?: string;
                };

                const userMessage = body.message?.trim();
                const sessionId = body.sessionId?.trim() || "default";

                if (!userMessage) {
                    return new Response(JSON.stringify({ error: "Missing message" }), {
                        status: 400,
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders,
                        },
                    });
                }

                const plan = await runPlanner(env, userMessage);

                const systemPrompt = `
        You are PrepForge AI, an expert assistant for software engineering internship applications.

        Task type: ${plan.taskType}
        Key topics: ${Array.isArray(plan.keyTopics) ? plan.keyTopics.join(", ") : ""}
        Execution instructions: ${plan.executionPrompt}
        `;

                const id = env.CHAT_SESSION.idFromName(sessionId);
                const stub = env.CHAT_SESSION.get(id);

                const historyRes = await stub.fetch("http://do/history");
                const historyData = (await historyRes.json()) as { messages: ChatMessage[] };
                const history = historyData.messages || [];

                const messages: ChatMessage[] = [
                    { role: "system", content: systemPrompt },
                    ...history,
                    { role: "user", content: userMessage },
                ];

                const result = await env.AI.run(
                    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                    { messages }
                );

                const assistantText =
                    (result as { response?: string }).response || "No response generated.";

                await stub.fetch("http://do/append", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: { role: "user", content: userMessage },
                    }),
                });

                await stub.fetch("http://do/append", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: { role: "assistant", content: assistantText },
                    }),
                });

                return new Response(
                    JSON.stringify({
                        response: assistantText,
                        sessionId,
                        plan
                    }),
                    {
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders,
                        },
                    }
                );
            } catch (error) {
                return new Response(
                    JSON.stringify({
                        error: "Invalid request",
                        details: error instanceof Error ? error.message : "Unknown error",
                    }),
                    {
                        status: 400,
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders,
                        },
                    }
                );
            }
        }

        return new Response("Not Found", {
            status: 404,
            headers: corsHeaders,
        });
    },
};