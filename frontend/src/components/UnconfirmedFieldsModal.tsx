export interface UnconfirmedFieldItem {
  label: string;
  detail: string;
}

interface UnconfirmedFieldsModalProps {
  items: UnconfirmedFieldItem[];
  onEdit: () => void;
  onSaveAnyway: () => void;
}

// Se abre desde MedicalConsultationsPage.handleSubmit cuando hay texto
// escrito en Paciente/Cliente/Tx. sin confirmar con su boton individual —
// ver computePendingFields ahi. "Editar" no toca nada (el vet corrige a
// mano); "Guardar asi" auto-confirma cada pendiente con el texto ya escrito
// y procede con el guardado normal, en un solo intento.
export function UnconfirmedFieldsModal({ items, onEdit, onSaveAnyway }: UnconfirmedFieldsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onEdit}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3>Hay campos sin confirmar</h3>
        <p>
          Escribiste texto en los siguientes campos pero no confirmaste su creación con el botón
          correspondiente. Puedes editarlos o guardar la consulta usando el texto tal como está.
        </p>
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <strong>{item.label}:</strong> {item.detail}
            </li>
          ))}
        </ul>
        <div className="inline-actions modal-actions-end">
          <button className="button ghost" onClick={onEdit} type="button">
            Editar
          </button>
          <button className="button" onClick={onSaveAnyway} type="button">
            Guardar así
          </button>
        </div>
      </div>
    </div>
  );
}
