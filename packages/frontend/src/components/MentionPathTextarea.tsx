import React, { useEffect, useMemo, useRef, useState } from "react";

type MentionPathTextareaProps = {
  value: string;
  onChange: (nextValue: string) => void;
  suggestions: string[];
  sections?: Array<{
    label: string;
    suggestions: string[];
  }>;
  placeholder?: string;
  rows?: number;
  id?: string;
  className?: string;
  disabled?: boolean;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

const getActiveMention = (value: string, caret: number): ActiveMention | null => {
  const beforeCaret = value.slice(0, caret);
  const mentionStart = beforeCaret.lastIndexOf("@");

  if (mentionStart < 0) return null;
  if (mentionStart > 0 && /\S/.test(beforeCaret[mentionStart - 1])) {
    return null;
  }

  const query = beforeCaret.slice(mentionStart + 1);
  if (/\s/.test(query)) return null;

  return {
    start: mentionStart,
    end: caret,
    query,
  };
};

const getCaretPosition = (textarea: HTMLTextAreaElement) => {
  const div = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  const properties = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontFamily",
    "lineHeight",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
  ] as const;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";

  properties.forEach((property) => {
    div.style[property] = style[property];
  });

  div.textContent = textarea.value.slice(0, textarea.selectionStart || 0);

  const span = document.createElement("span");
  span.textContent = textarea.value.slice(textarea.selectionStart || 0, (textarea.selectionStart || 0) + 1) || " ";
  div.appendChild(span);

  document.body.appendChild(div);
  const top = span.offsetTop - textarea.scrollTop;
  const left = span.offsetLeft - textarea.scrollLeft;
  document.body.removeChild(div);

  return { top, left };
};

export const MentionPathTextarea: React.FC<MentionPathTextareaProps> = ({
  value,
  onChange,
  suggestions,
  sections,
  placeholder,
  rows = 4,
  id,
  className,
  disabled,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const filteredSuggestions = useMemo(() => {
    if (!activeMention) return [];
    const query = activeMention.query.toLowerCase();

    if (sections?.length) {
      return sections.flatMap((section) =>
        section.suggestions.filter((item) => item.toLowerCase().includes(query)),
      );
    }

    return suggestions.filter((item) => item.toLowerCase().includes(query));
  }, [activeMention, sections, suggestions]);

  const filteredSections = useMemo(() => {
    if (!activeMention || !sections?.length) return [];
    const query = activeMention.query.toLowerCase();

    return sections
      .map((section) => ({
        label: section.label,
        suggestions: section.suggestions.filter((item) =>
          item.toLowerCase().includes(query),
        ),
      }))
      .filter((section) => section.suggestions.length > 0);
  }, [activeMention, sections]);

  useEffect(() => {
    if (!filteredSuggestions.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, filteredSuggestions.length - 1));
  }, [filteredSuggestions]);

  const closeMenu = () => {
    setActiveMention(null);
    setSelectedIndex(0);
  };

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const refreshMention = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const mention = getActiveMention(value, textarea.selectionStart || 0);
    if (!mention) {
      closeMenu();
      return;
    }

    setActiveMention(mention);
    const caret = getCaretPosition(textarea);
    setMenuPosition({ top: caret.top + 24, left: caret.left });
  };

  const applySuggestion = (suggestion: string) => {
    const textarea = textareaRef.current;
    if (!textarea || !activeMention) return;

    const nextValue = `${value.slice(0, activeMention.start + 1)}${suggestion}${value.slice(activeMention.end)}`;
    onChange(nextValue);
    closeMenu();

    requestAnimationFrame(() => {
      const nextCaret = activeMention.start + 1 + suggestion.length;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <div className="mention-textarea" ref={wrapperRef}>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={rows}
        className={className}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(refreshMention);
        }}
        onClick={refreshMention}
        onKeyUp={refreshMention}
        onKeyDown={(event) => {
          if (!activeMention || !filteredSuggestions.length) {
            if (event.key === "Escape" || event.key === "Backspace") {
              closeMenu();
            }
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((current) =>
              Math.min(current + 1, filteredSuggestions.length - 1),
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((current) => Math.max(current - 1, 0));
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            applySuggestion(filteredSuggestions[selectedIndex] || filteredSuggestions[0]);
            return;
          }

          if (event.key === "Escape" || event.key === "Backspace") {
            closeMenu();
          }
        }}
      />
      {activeMention && filteredSuggestions.length > 0 && (
        <div
          className="mention-textarea__menu"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          {filteredSections.length > 0
            ? (() => {
                let globalIndex = 0;
                return filteredSections.map((section) => (
                  <div key={section.label}>
                    <div className="mention-textarea__section-label">
                      {section.label}
                    </div>
                    {section.suggestions.slice(0, 50).map((item) => {
                      const itemIndex = globalIndex;
                      globalIndex += 1;
                      return (
                        <button
                          key={`${section.label}-${item}`}
                          type="button"
                          className={`mention-textarea__item${selectedIndex === itemIndex ? " is-active" : ""}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applySuggestion(item);
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()
            : filteredSuggestions.slice(0, 50).map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={`mention-textarea__item${selectedIndex === index ? " is-active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(item);
                  }}
                >
                  {item}
                </button>
              ))}
        </div>
      )}
    </div>
  );
};
