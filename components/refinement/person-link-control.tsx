"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

export interface PersonLinkOption {
  readonly id: string;
  readonly displayName: string;
  readonly roleTitle: string | null;
  readonly organisation: string | null;
  readonly status: "active" | "inactive";
}

type LinkResult = {
  readonly ok: boolean;
  readonly error?: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function personMeta(person: PersonLinkOption): string {
  return [person.roleTitle, person.organisation].filter(Boolean).join(" · ");
}

export function PersonLinkControl({
  targetId,
  people,
  initialPersonId = null,
  onChange,
}: {
  targetId: string;
  people: readonly PersonLinkOption[];
  initialPersonId?: string | null;
  onChange: (personId: string | null) => Promise<LinkResult>;
}) {
  const router = useRouter();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [personId, setPersonId] = useState<string | null>(initialPersonId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const person = people.find((item) => item.id === personId) ?? null;
  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return people;

    return people.filter((item) =>
      `${item.displayName} ${item.roleTitle ?? ""} ${item.organisation ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [people, query]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function selectPerson(nextPersonId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await onChange(nextPersonId);
      if (!result.ok) {
        setError(result.error ?? "Could not update the linked person.");
        return;
      }

      setPersonId(nextPersonId);
      setOpen(false);
      setQuery("");
      router.refresh();
    });
  }

  return (
    <div className="person-select" data-target-id={targetId} ref={rootRef}>
      <button
        type="button"
        className={`person-select__trigger${open ? " person-select__trigger--open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={pending}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
      >
        <span
          className={`person-select__avatar${person ? " person-select__avatar--linked" : ""}`}
          aria-hidden="true"
        >
          {person ? initials(person.displayName) : "+"}
        </span>
        <span className="person-select__trigger-copy">
          <span className="person-select__trigger-label">
            {pending
              ? "Saving link…"
              : person
                ? person.displayName
                : "Link a person"}
          </span>
          <span className="person-select__trigger-meta">
            {person
              ? personMeta(person) || "Saved in People"
              : people.length > 0
                ? `${people.length} ${people.length === 1 ? "person" : "people"} in your workspace`
                : "Add someone to People first"}
          </span>
        </span>
        <svg
          className="person-select__chevron"
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
        </svg>
      </button>

      {open ? (
        <div className="person-select__popover">
          <div className="person-select__search">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your people…"
              aria-label="Search your people"
              autoFocus
            />
          </div>

          <div
            id={listboxId}
            className="person-select__options"
            role="listbox"
            aria-label="People in your workspace"
          >
            {filteredPeople.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected={item.id === personId}
                className="person-select__option"
                key={item.id}
                onClick={() => selectPerson(item.id)}
              >
                <span
                  className="person-select__avatar person-select__avatar--option"
                  aria-hidden="true"
                >
                  {initials(item.displayName)}
                </span>
                <span className="person-select__option-copy">
                  <span className="person-select__option-name">
                    {item.displayName}
                    {item.status === "inactive" ? (
                      <span className="person-select__inactive">Inactive</span>
                    ) : null}
                  </span>
                  <span className="person-select__option-meta">
                    {personMeta(item) || "Person in your workspace"}
                  </span>
                </span>
                {item.id === personId ? (
                  <svg
                    className="person-select__check"
                    viewBox="0 0 20 20"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="m4.5 10 3.3 3.3 7.7-7.6" />
                  </svg>
                ) : null}
              </button>
            ))}

            {filteredPeople.length === 0 ? (
              <div className="person-select__empty">
                <p>{people.length === 0 ? "No people captured yet" : "No people match"}</p>
                <span>
                  {people.length === 0
                    ? "Add people once, then link them to actions and context."
                    : "Try a name, role, or organisation."}
                </span>
              </div>
            ) : null}
          </div>

          <div className="person-select__footer">
            {person ? (
              <button
                type="button"
                className="person-select__unlink"
                onClick={() => selectPerson(null)}
              >
                Remove link
              </button>
            ) : (
              <span>Only people saved in this workspace appear here.</span>
            )}
            <Link href="/people">Manage people</Link>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
