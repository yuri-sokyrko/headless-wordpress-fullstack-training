# ADR 0009: Preview-only Faust adoption

- **Status:** Accepted

## Context

The project needs a frontend architecture for its headless WordPress application. Faust provides WordPress-focused integrations and may be useful for exploring preview workflows. However, adopting it as the foundation for the main frontend would introduce a framework-specific layer and additional conventions that the application would need to maintain alongside its core Next.js architecture.

The primary application needs to remain straightforward to develop, test, deploy, and extend using Next.js directly. Preview functionality is worth investigating, but it does not justify making Faust a production dependency or shaping the entire frontend around it before its value and maintenance costs are established.

## Decision

The main frontend application **must use Next.js directly**. Faust is permitted only as a limited experiment for WordPress preview functionality. It is not the selected framework for the main frontend and must not become a required dependency of the production application.

Any experiment should be isolated, have a clearly scoped purpose, and avoid coupling the main application to Faust-specific APIs or conventions. Production preview requirements should be implemented or retained in a way that does not make the main frontend dependent on the experiment.

## Rationale

- Keeps Next.js as the single, explicit foundation for the main frontend.
- Avoids introducing a second framework-specific abstraction layer before its benefits are demonstrated.
- Limits long-term maintenance, upgrade, and knowledge-transfer costs associated with an additional dependency.
- Allows the team to evaluate Faust's preview capabilities without committing the production architecture to it.

## Consequences

- The main frontend uses Next.js conventions and APIs; Faust-specific functionality is not assumed to be available there.
- Preview experiments may be used to inform a future decision, but are not production architecture by default.
- If Faust is proposed for broader adoption, a new ADR must compare its demonstrated benefits and operational costs against a Next.js-based approach and explicitly supersede this decision.
- The experiment should be discontinued if it does not provide sufficient value for preview workflows.
