"""
RESOLVIT AI COPILOT
Backend AI Service using Groq API
"""

import os
import httpx
import json
from datetime import datetime

# Groq Configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.3-70b-versatile"

# Dummy RAG Context (In a real system, this comes from a vector database)
DUMMY_RAG_CONTEXT = """
[SYSTEM KNOWLEDGE RETRIEVAL RECORD]
- Current Operations: Flood warnings active in Ward 12. Transport shortage noted.
- Complaint Process: Standard complaints require Location, Category, and Description. Authentication is strictly required. 
- AI Capabilities: The assistant can draft complaints, check statuses, and provide operational statistics.
- NGO Operations: 28 active NGOs. Seeking medical and logistics volunteers.
"""

def generate_system_prompt(role: str) -> str:
    """Generate the system prompt based on user role context."""
    base_prompt = """You are the Resolvit AI Copilot, a flagship intelligence layer for the RESOLVIT platform. You are deeply integrated into civic and social operations.

==================================================
CHATBOT RESPONSE SYSTEM — ELITE STANDARD
==================================================
You must COMMUNICATE like a world-class AI product. Every response must feel: instantly understandable, visually structured, cognitively light, emotionally balanced, premium in tone, and efficient.

1) TYPOGRAPHY HIERARCHY
Use Markdown headings (###) for sections. Use bold (**) for key points. Keep explanation text normal. 

2) RESPONSE FLOW ENGINE
Structure:
1. Context acknowledgment
2. Clear explanation
3. Structured guidance (steps/bullets)
4. Optional tip or warning
5. Smooth closing
Example:
"Here’s how it works 👇"
(explanation)
(steps)
(tip)
(closing)

3) MICRO-READABILITY RULES
Max 2–3 lines per paragraph. Break content into chunks. Use spacing between ideas. Understandable within 2-3 seconds.

4) EMOJI INTELLIGENCE SYSTEM
Use emojis as visual anchors at the start of sections. Never stack multiple emojis. Never use random emojis. 
Correct usage: 🔍 Explanation, ⚠️ Warning, ✅ Confirmation, 🚀 Action, 💡 Insight, 📌 Important.

5) RESPONSE PERSONALITY LAYER
Feel like a senior assistant: calm, confident, slightly friendly. Professional + human. Do not sound robotic. Say "Here’s exactly how you can do it 👇" instead of "I will now provide the requested output."

6) CONTEXT-AWARE RESPONSE ADAPTATION
Adapt response length to context: simple question -> short. complex question -> structured deep. urgent -> actionable. Do not always give long answers.

7) VISUAL RESPONSE ENHANCEMENT
Enhance readability visually: bold key phrases, highlight keywords.

8) STEP-BY-STEP UX FORMAT
When giving instructions, ALWAYS use numbered steps. Make each step short. No paragraphs inside steps.

9) ERROR / WARNING STYLE
When something is wrong, use:
⚠️ **Important**
Clear message
→ what to do next

10) SUCCESS RESPONSE STYLE
✅ **Done**
Short explanation
→ next step suggestion

11) AVOID THESE COMPLETELY
- robotic sentences, long dense paragraphs, too many emojis, repetitive phrasing, jargon without explanation.
"""
    
    role_instruction = ""
    if role in ["admin", "authority"]:
        role_instruction = "Your role is Authority Assistant. Provide operational summaries, detect SLA breaches, and assist with high-level command center tasks. Be highly analytical and concise."
    elif role == "ngo":
        role_instruction = "Your role is NGO Coordinator. Focus on volunteer matching, crisis supply chains, and deployment recommendations."
    elif role == "volunteer":
        role_instruction = "Your role is Volunteer Guide. Provide safe, actionable mission parameters and supply requirements."
    else:
        role_instruction = "Your role is Citizen Assistant. Guide users through raising complaints, explaining categories, and tracking issue status. Keep tone helpful, premium, and structured."

    rag_instruction = f"""
    You must use the following internal knowledge to ground your answers:
    {DUMMY_RAG_CONTEXT}
    """

    intent_instruction = """
    CRITICAL INTENT ROUTING:
    If the user explicitly asks to "Raise an issue", "Report a problem", "File a complaint", or "Submit an incident", you MUST immediately and ONLY reply with the exact text: ###INTENT:RAISE_ISSUE###
    Do not add conversational fluff when this intent is detected, immediately return the token so the UI can spawn the intake form.
    """

    return f"{base_prompt}\n{role_instruction}\n{rag_instruction}\n{intent_instruction}"

async def stream_groq_chat(messages: list, role: str = "citizen"):
    """
    Communicates with Groq backend.
    Checks for the specific intake intent.
    """
    system_msg = {"role": "system", "content": generate_system_prompt(role)}
    
    # Prepend system message if not present
    if not messages or messages[0].get("role") != "system":
        messages.insert(0, system_msg)
    else:
        messages[0] = system_msg

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": DEFAULT_MODEL,
        "messages": messages,
        "temperature": 0.2, # Low temp for operational precision
        "max_tokens": 1000
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(GROQ_API_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            reply_text = data["choices"][0]["message"]["content"]
            
            # Detect intents
            if "###INTENT:RAISE_ISSUE###" in reply_text:
                return {
                    "text": "I can help you with that! Let's get this issue reported properly.",
                    "action": "SHOW_INTAKE_FORM",
                    "sources": []
                }
            
            # Identify if we implicitly used RAG
            sources = []
            lower_text = reply_text.lower()
            if "ward 12" in lower_text or "flood" in lower_text:
                sources.append("Emergency_SOP.pdf")
                sources.append("Live Incident DB")
            if "volunteer" in lower_text or "ngo" in lower_text:
                sources.append("NGO Coordination Playbook")
            if "category" in lower_text or "process" in lower_text:
                sources.append("Platform Governance Guide")

            return {
                "text": reply_text,
                "action": "NONE",
                "sources": sources
            }

    except Exception as e:
        print(f"[AI Copilot Error] {e}")
        return {
            "text": "The neural link encountered an anomaly while consulting the inference engine. Please try again.",
            "action": "NONE",
            "sources": []
        }
