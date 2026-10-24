import { useState } from "react";
import type { BuildTaskTarget } from "../types/buildTasks";
import { Modal } from "./Modal";

export function BuildTaskParameters(props: {
  target: BuildTaskTarget;
  pending: boolean;
  error: string | null;
  close: () => void;
  launch: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const invalid = props.target.parameters.some(
    (parameter) => parameter.required && !values[parameter.name]?.trim(),
  );
  return (
    <Modal
      open
      title={`Run ${props.target.name}`}
      onClose={() => {
        if (!props.pending) props.close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) props.launch(values);
        }}
      >
        {props.target.parameters.map((parameter) => {
          const input = {
            id: `build-arg-${parameter.name}`,
            required: parameter.required,
            value: values[parameter.name] ?? "",
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
            ) =>
              setValues((previous) => ({
                ...previous,
                [parameter.name]: event.target.value,
              })),
          };
          return (
            <div className="form-field" key={parameter.name}>
              <label htmlFor={input.id}>
                {parameter.name}
                {parameter.required ? " (required)" : " (optional)"}
              </label>
              {parameter.choices.length ? (
                <select {...input}>
                  <option value="">Select a value</option>
                  {parameter.choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...input} maxLength={4096} />
              )}
            </div>
          );
        })}
        {props.error && (
          <div role="alert" className="alert error">
            {props.error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            disabled={props.pending}
            onClick={props.close}
          >
            Cancel
          </button>
          <button type="submit" disabled={props.pending || invalid}>
            {props.pending ? "Starting…" : "Run"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
