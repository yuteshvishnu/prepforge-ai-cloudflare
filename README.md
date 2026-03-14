## Author

Yutesh Vishnu Addanki  
MS Computer Science — University of Wisconsin–Madison

# PrepForge — Stateful Application Assistant on Cloudflare

PrepForge is a small interactive application built on Cloudflare’s developer platform to demonstrate how a stateful AI-powered workflow can be implemented using Workers, Workers AI, and Durable Objects.

The application allows users to refine job-application content (resume bullets, project descriptions, interview preparation) through a chat interface while maintaining session context and coordinating multiple processing steps before producing a response.

## Design

Instead of sending a user prompt directly to a model, the backend follows a structured pipeline:

User Request  
→ Request Planning  
→ Task Execution  
→ Session Memory Update  
→ Streamed Response

The system first analyzes the incoming request and determines the type of task being performed. Based on that analysis, it generates execution instructions which are then used to produce the final response.

This separation between **planning and execution** allows the application to behave like a coordinated workflow rather than a single prompt-response interaction.

## Cloudflare Components Used

### Workers
Cloudflare Workers act as the main coordination layer.  
The Worker handles routing, request validation, planner execution, response generation, and streaming progress updates back to the client.

### Workers AI
Workers AI is used for both the **planning step** and the **execution step**.  
The planner analyzes the user request and extracts task type, relevant topics, and execution instructions.  
The executor then produces the final response based on those instructions.

### Durable Objects
Durable Objects store conversation state for each session.  
This allows the system to maintain context across multiple user messages and generate responses that are aware of previous interactions.

### Streaming Responses
The backend streams progress events to the client while processing a request.  
Users can see which step the system is currently performing before the final result is returned.

## Architecture

React Frontend  
↓  
Cloudflare Worker (API + coordination)  
↓  
Planner Step  
↓  
Execution Step  
↓  
Durable Object Session Memory  
↓  
Streamed Response

All backend logic runs on Cloudflare’s edge platform.

## Demo

<img src="assets/demo.png" width="800"/>
