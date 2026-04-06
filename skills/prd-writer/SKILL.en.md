# Skill: PRD Writer

> Assist in writing scenario-driven requirements documents — starting from user pain points, identifying core business scenarios, and defining GIVEN/WHEN/THEN acceptance criteria for each scenario. Scenario numbers will carry through all subsequent phases.

## Trigger Conditions

- User requests writing a requirements document, product requirements, or PRD
- User discusses product positioning, target users, or feature requirements
- User mentions "Phase 1", "requirements layer", or "WHY"
- The project is currently in the requirements analysis phase

## Core Capabilities

1. Guide users through product positioning and target user profiling
2. Extract user pain points and establish causal chains
3. Identify and define business scenarios from pain points (assigning `S01`, `S02`... numbers)
4. Write GIVEN/WHEN/THEN acceptance criteria for each scenario
5. Prioritize scenarios
6. Identify constraints and the "won't-do" list
7. Generate scenario-driven requirements documents conforming to the OpenLogos specification

## Execution Steps

### Step 1: Understand Product Positioning

Confirm the following key questions with the user (proactively ask if information is insufficient):

- **One-line positioning**: What is this product? For whom? What problem does it solve?
- **Target user persona**: Specific enough to describe a real person
- **Core objectives**: What should the product achieve, and what metrics define success

### Step 2: Extract User Pain Points

Guide the user to identify pain points from the following dimensions:

- How does the user currently do it? (Current state)
- What difficulties are encountered in the process? (Pain points)
- What consequences do the difficulties cause? (Impact)
- How does the user expect it to be resolved? (Expectation)

**Every pain point must have a causal chain**: Because [reason] → leads to [pain point] → results in [consequence]

Assign a number to each pain point (`P01`, `P02`...) for scenario traceability.

### Step 3: Identify and Define Scenarios

**Scenarios are the anchor throughout the entire development lifecycle.** This step is critical.

Extract business scenarios from pain points and requirements. Each scenario is a **complete user action path**:

- **Who** triggers it under **what circumstances**
- Through **what steps**
- To achieve **what outcome**

Assign a globally unique number to each scenario (`S01`, `S02`...). This number will carry through to Phase 2 and Phase 3.

Output a scenario list table:

```markdown
| ID   | Scenario Name      | Trigger Condition          | Related Pain Point | Priority |
|------|--------------------|----------------------------|--------------------|----------|
| S01  | Email Registration  | New user's first visit     | P01                | P0       |
| S02  | Password Login      | Registered user returns    | P01                | P0       |
| S03  | Forgot Password     | User cannot log in         | P02                | P1       |
```

### Step 4: Write Scenario Acceptance Criteria

Write acceptance criteria for every P0 and P1 scenario:

```markdown
### S01: Email Registration

- **Trigger Condition**: New user's first visit, clicks "Sign Up"
- **User Value**: Quickly create an account and start using the product (← P01)
- **Priority**: P0
- **Main Path**: User fills in email and password, submits the form, receives a verification email, clicks the link to complete registration

#### Acceptance Criteria

##### Normal: Complete registration flow
- **GIVEN** the user has not registered before and is on the registration page
- **WHEN** the user fills in a valid email and password (≥8 characters) and clicks "Sign Up"
- **THEN** the system creates an account, sends a verification email, and the page displays "Please check your email for verification"

##### Exception: Email already registered
- **GIVEN** the email test@example.com is already registered
- **WHEN** the user attempts to register using test@example.com
- **THEN** the page displays "This email is already registered, please log in directly" and no email is sent

##### Exception: Password does not meet requirements
- **GIVEN** the user is on the registration page
- **WHEN** the user fills in a valid email but a password with fewer than 8 characters and clicks "Sign Up"
- **THEN** the page displays "Password must be at least 8 characters" and the request is not submitted
```

**Principles for writing acceptance criteria**:

- Each scenario must have at least 1 normal + 1 exception acceptance criterion
- GIVEN describes the initial state — specific enough to be reproducible
- WHEN describes the user action — precise down to the button level
- THEN describes the expected behavior — specific enough to be verifiable
- Avoid vague wording: "fast", "friendly", "reasonable" → quantify with concrete metrics

### Step 5: Identify Constraints and Boundaries

- **Technical constraints**: Technology stack limitations, third-party service limitations
- **Resource constraints**: Team size, time window
- **"Won't-do" list**: Explicitly list features and scenarios that are out of scope for this phase to prevent scope creep

### Step 6: Assemble the Requirements Document

Output the complete document in the standard structure:

```markdown
# [Product Name] Requirements Document

> Last updated: [date]

## I. Product Background and Goals
### 1.1 Product Positioning
### 1.2 Core Objectives
### 1.3 Target User Persona

## II. User Pain Point Analysis
### P01: [Pain Point Name]
Because [reason] → leads to [pain point] → results in [consequence]
### P02: ...

## III. Scenario Overview
[Scenario list table: ID / Name / Trigger Condition / Related Pain Point / Priority]

## IV. Core Scenario Details
### S01: [Scenario Name]
[Trigger Condition + User Value + Priority + Main Path + Acceptance Criteria]
### S02: ...

## V. Constraints and Boundaries
### 5.1 Technical Constraints
### 5.2 Resource and Time Constraints
### 5.3 "Won't-Do" List
```

## Output Specification

- File format: Markdown
- Storage location: `logos/resources/prd/1-product-requirements/`
- File naming: `{sequence}-{english-name}.md`, e.g., `01-requirements.md`
- Every scenario must be traceable to at least one user pain point
- P0/P1 scenarios must have GIVEN/WHEN/THEN (≥1 normal + ≥1 exception)
- Scenario numbers are globally unique and will carry through Phase 2 and Phase 3

## Best Practices

- **Cast a wide net first, then narrow down**: In the first pass, identify as many scenarios as possible, then cut non-core ones during prioritization
- **Scenarios ≠ Features**: A single feature (e.g., "user authentication") may contain multiple scenarios (registration, login, password recovery); a single scenario (e.g., "first purchase") may span multiple features (browsing, adding to cart, payment). A scenario is a "complete path from the user's perspective"
- **Scenario granularity**: Keep granularity moderate in Phase 1. Too fine-grained ("user clicks the input box") is meaningless; too coarse ("user uses the product") is unverifiable. Good granularity: the main path of a scenario can be walked through in 1–2 minutes
- **Acceptance criteria are the precise expression of requirements**: If you cannot write GIVEN/WHEN/THEN, the scenario is not yet well thought out
- **Exception scenarios are equally important**: Users don't always follow the happy path — exception handling often defines the product experience
- **The "won't-do" list is the hardest to write**: Restraint is the most important skill of a product manager
- **Once a scenario number is assigned, it is never reused**: Even if a scenario is deprecated, its number is not recycled, to avoid confusion
- **Requirements documents are living documents**: They are continuously updated as the product evolves, with every change tracked through Delta change management

## Recommended Prompts

The following prompts can be copied directly for use with an AI:

- `Help me write a requirements document`
- `I want to build a xxx product, help me sort out the requirements`
- `Help me organize these ideas into a structured requirements document`
- `Help me add exception scenario acceptance criteria to an existing requirements document`
