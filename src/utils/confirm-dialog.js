/**
 * The app's confirmation dialog for destructive actions.
 *
 * This is the same overlay/modal the note-delete and module-remove flows build
 * by hand (`.delete-confirm-overlay` > `.delete-confirm-modal` > <p> +
 * `.modal-btn-container`, styled in public/styles.css and sitting at z-index
 * 2000 — above the floating panels at 1200/1201). Factored out so new callers
 * get the house look, the click-outside dismissal and the Escape handling for
 * free instead of copying the markup a sixth time.
 */

/**
 * @param {object} o
 * @param {string} o.messageHtml  dialog copy — callers MUST escape any
 *                                user-supplied text before interpolating
 * @param {string} [o.confirmLabel='Yes']
 * @param {string} [o.cancelLabel='Cancel']
 * @param {() => void} o.onConfirm
 * @param {() => void} [o.onCancel]
 */
export function showConfirmation({
  messageHtml,
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const overlay = document.createElement('div');
  overlay.className = 'delete-confirm-overlay';

  const modal = document.createElement('div');
  modal.className = 'delete-confirm-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const message = document.createElement('p');
  message.innerHTML = messageHtml;
  modal.appendChild(message);

  const btnContainer = document.createElement('div');
  btnContainer.className = 'modal-btn-container';

  // Order matters: the stylesheet colors :first-child danger and :last-child
  // as the safe option.
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = confirmLabel;
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = cancelLabel;

  function close() {
    document.removeEventListener('keydown', onKeydown);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    if (onCancel) onCancel();
  }

  confirmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
    if (onConfirm) onConfirm();
  });

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
    if (onCancel) onCancel();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    e.stopPropagation();
    close();
    if (onCancel) onCancel();
  });

  document.addEventListener('keydown', onKeydown);

  btnContainer.append(confirmBtn, cancelBtn);
  modal.appendChild(btnContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  cancelBtn.focus();
  return close;
}
