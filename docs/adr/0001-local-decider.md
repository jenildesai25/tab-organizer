# Filing reads a feature card, and the model is opt-in

The organizer has to file tabs without reading pages, without loading a model inside the browser, and with the model switched off. Filing is a pure decider over a feature card. A local model is asked only after the person turns the LLM switch on, and only when the heuristic is unsure.

Sending the page to a model on every tab would wake discarded tabs and stall the tab strip. Calling the model whenever a sentence is unclear would make a saved rule, and ordinary filing, depend on a process that may not be running.
