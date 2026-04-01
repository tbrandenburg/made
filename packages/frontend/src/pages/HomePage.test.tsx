// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage";

const HISTORY_STORAGE_KEY = "made.navigation-history.v1";
const FAVORITES_STORAGE_KEY = "made.favorites.v1";

describe("HomePage favorites", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds and removes history items from favorites", async () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "repository:alpha",
          kind: "repository",
          name: "alpha",
          path: "/repositories/alpha",
          visitedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "No favorite repositories, tasks, knowledge artefacts, or constitutions yet.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Add alpha to favorites"));

    const favoritesHeading = screen.getByRole("heading", { name: "Favorites" });
    const favoritesSection = favoritesHeading.closest("section");
    expect(favoritesSection).not.toBeNull();

    const favoriteLink = within(favoritesSection as HTMLElement).getByRole(
      "link",
      { name: /alpha/i },
    );
    expect(favoriteLink).toHaveAttribute("href", "/repositories/alpha");

    fireEvent.click(screen.getByLabelText("Remove alpha from favorites"));
    expect(
      screen.getByText(
        "No favorite repositories, tasks, knowledge artefacts, or constitutions yet.",
      ),
    ).toBeInTheDocument();

    expect(localStorage.getItem(FAVORITES_STORAGE_KEY)).toBe("[]");
  });
});
