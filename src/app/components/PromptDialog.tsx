import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

export interface PromptRequest {
  message: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

export function PromptDialog({ request, onDone }: { request: PromptRequest | null; onDone: () => void }) {
  const { t } = useTranslation();
  const cancel = () => {
    request?.resolve(null);
    onDone();
  };
  return (
    <Modal open={!!request} onClose={cancel} label={request?.message ?? ""} boxClassName="w-[min(420px,92vw)] max-w-none p-6">
      {request ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("val") as string;
            request.resolve(value);
            onDone();
          }}
        >
          <h3 className="mb-4 mt-0 text-lg font-semibold">{request.message}</h3>
          <input
            id="prompt-dialog-input"
            className="input input-bordered mb-6 w-full"
            name="val"
            defaultValue={request.defaultValue}
            autoFocus
            onFocus={(event) => {
              // Select the file stem so typing replaces the name but keeps the extension.
              const value = event.currentTarget.value;
              const dot = value.lastIndexOf(".");
              event.currentTarget.setSelectionRange(0, dot > 0 ? dot : value.length);
            }}
          />
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary">
              {t("common.ok")}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
