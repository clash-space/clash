export function replaceContentEditableHtmlPreservingFocus(element: HTMLElement, html: string): void {
    const ownerDocument = element.ownerDocument;
    const selection = ownerDocument.getSelection?.();
    const hadFocus = ownerDocument.activeElement === element;

    element.innerHTML = html;

    if (!hadFocus || !selection) return;

    const range = ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}
