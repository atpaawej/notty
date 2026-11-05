# Rich-text editing over Markdown storage rather than a Markdown editor

Notty presents an Apple Notes-style WYSIWYG editor while persisting Markdown. The editor is a rendering and input layer over Markdown: content round-trips through a serializer on every auto-save, and attachments are referenced by relative path.

The obvious alternative — a plain Markdown source editor with a preview pane — would remove the serializer entirely and never lose fidelity. We rejected it because the product's north star is the Apple Notes feel. Typing Markdown syntax is a different product with a different audience. We accept the serializer as the price of that feel, and treat round-trip fidelity as a first-class test obligation.

**Consequences:** Any editor object that cannot survive a Markdown round-trip cannot ship in v1. Images must be files in `attachments/`, never inline base64. The serializers are the highest-risk code in the app and are tested at their module interface.
