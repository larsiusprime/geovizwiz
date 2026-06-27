---
name: features
description: Skill describing how to properly agentically code features within a markdown feature file workflow
---

Each markdown file in here describes requirements for a feature that an agent should develop.

The agent should only develop the feature in the file specifically requested by the user.

The feature file will have a header called "Feature", which will have a subheading called "Requirement Summary" summarizing each requirement of that feature, and then optionally headers for specific requirements that describes them in more detail.

The file will also contain a header called "Changes/Fixes". This header will contain subheadings for individual changes that. The agent should use git diff to determine what new changes have been added between each prompt. After executing the desired change or fix, it should briefly summarize what it did under that header.