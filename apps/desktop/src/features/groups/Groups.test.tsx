import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type GroupSuggestion } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { GroupsContainer } from "./GroupsContainer";

function setup(seed: Parameters<typeof createMockApi>[0] = {}) {
  const mock = createMockApi(seed);
  const onOpenMeeting = vi.fn();
  render(
    <ApiProvider api={mock.api}>
      <GroupsContainer onOpenMeeting={onOpenMeeting} />
    </ApiProvider>,
  );
  return { ...mock, onOpenMeeting };
}

describe("GroupsContainer", () => {
  it("crea un grupo", async () => {
    const { controls } = setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Nombre del grupo nuevo" }), "Producto");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    expect(await screen.findByRole("button", { name: /Producto/ })).toBeInTheDocument();
    expect(controls.state.groups.map((g) => g.name)).toEqual(["Producto"]);
  });

  it("acepta una sugerencia con otro nombre", async () => {
    const sug: GroupSuggestion = { id: "s1", name: "Sprint planning", description: null, meetingIds: ["a", "b", "c"], cohesion: 0.9, createdAt: 0 };
    const { controls } = setup({ suggestions: [sug] });
    const box = await screen.findByRole("region", { name: "Grupos sugeridos" });
    const input = within(box).getByRole("textbox", { name: "Nombre de la sugerencia Sprint planning" });
    await userEvent.clear(input);
    await userEvent.type(input, "Planificación");
    await userEvent.click(within(box).getByRole("button", { name: "Aceptar Sprint planning" }));
    await waitFor(() => expect(controls.state.groups[0]?.name).toBe("Planificación"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Grupos sugeridos" })).not.toBeInTheDocument());
  });

  it("rechaza una sugerencia", async () => {
    const sug: GroupSuggestion = { id: "s1", name: "Ruido", description: null, meetingIds: [], cohesion: 0.8, createdAt: 0 };
    const { controls } = setup({ suggestions: [sug] });
    await userEvent.click(await screen.findByRole("button", { name: "Descartar Ruido" }));
    await waitFor(() => expect(controls.state.suggestions).toHaveLength(0));
  });

  it("abre un grupo, lista sus reuniones y permite añadir otra", async () => {
    const d = sampleMeeting();
    const { api, controls } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    controls.state.groups = [...controls.state.groups];
    // El contenedor ya cargó: forzamos recarga con el botón de actualizar.
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Otro");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Añadir reunión" }));
    await userEvent.click(await screen.findByRole("option", { name: /Daily del equipo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Añadir 1 reunión" }));
    expect(await screen.findByRole("button", { name: /^Daily del equipo/ })).toBeInTheDocument();
    expect(controls.state.groups.find((x) => x.id === g.id)!.meetingCount).toBe(1);
  });

  it("«Sugerir título» nombra el grupo por lo que se habló en sus reuniones", async () => {
    const d = sampleMeeting();
    const { api, controls } = setup({ meetings: [d] });
    const g = await api.groupCreate("test");
    await api.groupAddMeeting(g.id, d.meeting.id);
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Otro");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^test/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Sugerir título" }));
    await waitFor(() => expect(controls.state.groups.find((x) => x.id === g.id)!.name).toBe("Seguimiento: Daily del equipo"));
    expect(screen.getByRole("textbox", { name: "Nombre del grupo" })).toHaveValue("Seguimiento: Daily del equipo");
  });

  it("quita una reunión del grupo", async () => {
    const d = sampleMeeting();
    const { api } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    await api.groupAddMeeting(g.id, d.meeting.id);
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "X");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Quitar Daily del equipo del grupo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Daily del equipo/ })).not.toBeInTheDocument());
  });

  it("las citas del chat del grupo abren la reunión en su instante", async () => {
    const d = sampleMeeting();
    const { api, controls, onOpenMeeting } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "X");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    const t = await api.chatThreadCreate({ kind: "group", groupId: g.id });
    controls.state.messages.push({
      id: "a1",
      threadId: t.id,
      role: "assistant",
      content: "Se acordó [1]",
      citations: [{ n: 1, meetingId: d.meeting.id, meetingTitle: "Daily del equipo", at: 65_000, end: 70_000, snippet: "" }],
      provider: null,
      createdAt: 0,
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Daily del equipo, 01:05" }));
    expect(onOpenMeeting).toHaveBeenCalledWith(d.meeting.id, 65_000);
  });

  it("elimina un grupo tras confirmar", async () => {
    const { api, controls } = setup();
    await api.groupCreate("Borrar");
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Z");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(await screen.findByRole("button", { name: /^Borrar/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar grupo" }));
    await waitFor(() => expect(controls.state.groups.map((g) => g.name)).toEqual(["Z"]));
  });

  describe("Buscar sugerencias", () => {
    const sug: GroupSuggestion = { id: "s9", name: "Sprint planning", description: null, meetingIds: ["a", "b", "c"], cohesion: 0.9, createdAt: 0 };
    const meetings = (n: number) => Array.from({ length: n }, () => sampleMeeting());

    it("muestra carga mientras busca y deshabilita el botón", async () => {
      const { api } = setup();
      let done!: (s: GroupSuggestion[]) => void;
      api.groupSuggestionsRefresh = () => new Promise((r) => (done = r));
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      const busy = await screen.findByRole("button", { name: /Buscando/ });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Comparando tus reuniones…");
      done([]);
      await waitFor(() => expect(screen.getByRole("button", { name: "Buscar sugerencias" })).toBeEnabled());
      expect(screen.queryByText("Comparando tus reuniones…")).not.toBeInTheDocument();
    });

    it("sin resultados y con 1 reunión explica por qué", async () => {
      setup({ meetings: meetings(1) });
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByText(/Hacen falta al menos 3 reuniones parecidas; ahora tienes 1 reunión procesada\./)).toBeInTheDocument();
      expect(screen.getByText(/Graba o importa alguna más y vuelve a probar\./)).toBeInTheDocument();
    });

    it("sin resultados y con 3 o más reuniones propone crear un grupo a mano", async () => {
      setup({ meetings: meetings(4) });
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByText(/No he encontrado reuniones lo bastante parecidas entre tus 4 reuniones procesadas\./)).toBeInTheDocument();
      expect(screen.getByText(/Puedes crear un grupo a mano y añadirlas tú\./)).toBeInTheDocument();
    });

    it("sin reuniones dice que todavía no hay ninguna", async () => {
      setup({ meetings: [] });
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByText(/todavía no tienes ninguna reunión procesada/)).toBeInTheDocument();
    });

    it("si falla el recuento muestra el mensaje genérico sin número", async () => {
      const { api } = setup();
      api.meetingsList = () => Promise.reject(new Error("x"));
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByText(/No he encontrado reuniones lo bastante parecidas/)).toBeInTheDocument();
      expect(screen.queryByText(/procesadas/)).not.toBeInTheDocument();
    });

    it("con resultados enseña la caja y cuántas hay", async () => {
      const { api } = setup();
      api.groupSuggestionsRefresh = async () => [sug];
      api.groupSuggestionsList = async () => [sug];
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByText("1 sugerencia nueva")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Grupos sugeridos" })).toBeInTheDocument();
    });

    it("el aviso desaparece al descartar una sugerencia", async () => {
      const { api } = setup();
      let list: GroupSuggestion[] = [];
      api.groupSuggestionsList = async () => list;
      api.groupSuggestionsRefresh = async () => (list = [sug]);
      api.groupSuggestionDismiss = async () => void (list = []);
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      await screen.findByText("1 sugerencia nueva");
      await userEvent.click(screen.getByRole("button", { name: "Descartar Sprint planning" }));
      await waitFor(() => expect(screen.queryByText("1 sugerencia nueva")).not.toBeInTheDocument());
    });

    it("el aviso se puede cerrar", async () => {
      setup({ meetings: [] });
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      await screen.findByText(/todavía no tienes ninguna/);
      await userEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
      expect(screen.queryByText(/todavía no tienes ninguna/)).not.toBeInTheDocument();
    });

    it("un fallo se ve como alerta y Reintentar vuelve a buscar", async () => {
      const { api } = setup();
      let calls = 0;
      api.groupSuggestionsRefresh = async () => {
        if (calls++ === 0) throw { message: "El modelo no responde" };
        return [];
      };
      await userEvent.click(await screen.findByRole("button", { name: "Buscar sugerencias" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("El modelo no responde");
      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(calls).toBe(2);
    });
  });

  it("si la carga inicial falla muestra el error y Reintentar la repite", async () => {
    const mock = createMockApi();
    let calls = 0;
    const orig = mock.api.groupsList.bind(mock.api);
    mock.api.groupsList = async () => {
      if (calls++ === 0) throw { message: "Base de datos bloqueada" };
      return orig();
    };
    await mock.api.groupCreate("Atlas");
    render(
      <ApiProvider api={mock.api}>
        <GroupsContainer onOpenMeeting={vi.fn()} />
      </ApiProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos bloqueada");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: /Atlas/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si falla marcar favorito se deshace y se avisa", async () => {
    const mock = createMockApi();
    await mock.api.groupCreate("Atlas");
    mock.api.groupSetFavourite = async () => {
      throw { message: "No se pudo guardar" };
    };
    render(
      <ApiProvider api={mock.api}>
        <GroupsContainer onOpenMeeting={vi.fn()} />
      </ApiProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Marcar como favorito" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("button", { name: "Marcar como favorito" })).toHaveAttribute("aria-pressed", "false");
  });

  it("si falla crear un grupo se muestra el error", async () => {
    const { api } = setup();
    api.groupCreate = async () => {
      throw { message: "Nombre duplicado" };
    };
    await userEvent.type(await screen.findByRole("textbox", { name: "Nombre del grupo nuevo" }), "Dup");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nombre duplicado");
  });

  describe("detalle del grupo: los fallos se ven", () => {
    async function openGroup() {
      const d = sampleMeeting();
      const mock = createMockApi({ meetings: [d] });
      const g = await mock.api.groupCreate("Producto");
      await mock.api.groupAddMeeting(g.id, d.meeting.id);
      render(
        <ApiProvider api={mock.api}>
          <GroupsContainer onOpenMeeting={vi.fn()} />
        </ApiProvider>,
      );
      await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
      return mock.api;
    }

    it("quitar una reunión que falla enseña el error", async () => {
      const api = await openGroup();
      api.groupRemoveMeeting = async () => {
        throw { message: "No se pudo quitar" };
      };
      await userEvent.click(await screen.findByRole("button", { name: "Quitar Daily del equipo del grupo" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo quitar");
    });

    it("eliminar un grupo que falla enseña el error", async () => {
      const api = await openGroup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      api.groupDelete = async () => {
        throw { message: "No se pudo eliminar" };
      };
      await userEvent.click(await screen.findByRole("button", { name: "Eliminar grupo" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo eliminar");
    });

    it("renombrar un grupo que falla enseña el error", async () => {
      const api = await openGroup();
      api.groupUpdate = async () => {
        throw { message: "No se pudo guardar el nombre" };
      };
      const input = await screen.findByRole("textbox", { name: "Nombre del grupo" });
      await userEvent.clear(input);
      await userEvent.type(input, "Otro");
      await userEvent.tab();
      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar el nombre");
    });

    it("si falla la carga de reuniones del grupo, avisa", async () => {
      const mock = createMockApi();
      await mock.api.groupCreate("Producto");
      mock.api.meetingsList = async () => {
        throw { message: "Lista no disponible" };
      };
      render(
        <ApiProvider api={mock.api}>
          <GroupsContainer onOpenMeeting={vi.fn()} />
        </ApiProvider>,
      );
      await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Lista no disponible");
    });
  });
});
