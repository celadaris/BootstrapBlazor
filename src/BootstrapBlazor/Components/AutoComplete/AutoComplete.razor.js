// Original imports remain the same
import { debounce, registerBootstrapBlazorModule } from "../../modules/utility.js";
import { handleKeyUp, select, selectAllByFocus, selectAllByEnter } from "../Input/BootstrapInput.razor.js";
import Data from "../../modules/data.js";
import EventHandler from "../../modules/event-handler.js";
import Input from "../../modules/input.js";
import Popover from "../../modules/base-popover.js";

// Store dropdown item click timestamps globally (or scoped if preferred)
if (!window.dropdownItemClicks) {
    window.dropdownItemClicks = {};
}

export function init(id, invoke) {
    const el = document.getElementById(id);
    if (!el) {
        return;
    }
    if (Data.get(id)) {
        return;
    }

    const menu = el.querySelector('.dropdown-menu');
    const input = document.getElementById(`${id}_input`);
    if (!input || !menu) {
        return;
    }

    const ac = { el, invoke, menu, input };
    Data.set(id, ac);

    // --- Popover/Dropdown Setup ---
    const isPopover = input.getAttribute('data-bs-toggle') === 'bb.dropdown';
    if (isPopover) {
        ac.popover = Popover.init(el, { toggleClass: '[data-bs-toggle="bb.dropdown"]' });
    }
    else {
        // Apply custom class, offset etc.
        const extraClass = input.getAttribute('data-bs-custom-class');
        if (extraClass) menu.classList.add(...extraClass.split(' '));
        const offset = input.getAttribute('data-bs-offset');
        if (offset) {
            try {
                const [x, y] = offset.split(',').map(parseFloat);
                if (!isNaN(x) && x !== 0) menu.style.setProperty('margin-left', `${x}px`);
                if (!isNaN(y) && y !== 0) menu.style.setProperty('margin-top', `${y}px`);
            } catch (e) { }
        }
    }

    // --- Debounce Setup ---
    const duration = parseInt(input.getAttribute('data-bb-debounce') || '0');
    const filterDuration = duration > 0 ? duration : 0;
    const filterCallback = debounce(async v => {
        const currentAc = Data.get(id);
        if (!currentAc) return;
        try {
            currentAc.el.classList.add('is-loading');
            await currentAc.invoke.invokeMethodAsync('PerformFilteringAndCommitValue', v);
            showList(id);
        } catch (error) {
            // Silent fail for disposed instances
        } finally {
            if (currentAc.el) currentAc.el.classList.remove('is-loading');
        }
    }, filterDuration);

    // --- Event Listeners ---
    Input.composition(input, v => {
        const currentAc = Data.get(id);
        if (!currentAc) return;
        currentAc.el.classList.add('is-loading');
        filterCallback(v);
    });

    const keydownHandler = debounce(e => {
        const currentAc = Data.get(id);
        if (currentAc) handlerKeydown(currentAc, e);
    }, duration, e => ['ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'NumpadEnter'].includes(e.key));

    EventHandler.on(input, 'keydown', keydownHandler);

    EventHandler.on(menu, 'click', '.dropdown-item', e => {
        const currentAc = Data.get(id);
        if (!currentAc) return;
        const itemText = e.target.textContent;
        window.dropdownItemClicks[id] = Date.now();
        if (currentAc.popover) currentAc.popover.hide();
        else currentAc.el.classList.remove('show');
    });

    EventHandler.on(input, 'focus', e => {
        const currentAc = Data.get(id);
        if (!currentAc) return;
        const timeSinceItemClick = Date.now() - (window.dropdownItemClicks[id] || 0);
        if (timeSinceItemClick < 100) {
            delete window.dropdownItemClicks[id];
            return;
        }
        const showDropdownOnFocus = currentAc.input.getAttribute('data-bb-auto-dropdown-focus') === 'true';
        if (showDropdownOnFocus) {
            showList(id);
        }
    });

    ac.internalBlurHandler = () => handleBlur(id);
    EventHandler.on(input, 'blur', ac.internalBlurHandler);

    // Click Away Listener (Document Level) - Associated with THIS instance
    ac.internalClickAwayHandler = (event) => handleClickAway(event, id); // Pass the specific ID
    EventHandler.on(document, 'click', ac.internalClickAwayHandler, true);

    // Mousedown Listener (Document Level)
    ac.internalMousedownHandler = (event) => handleMousedown(event, id);
    EventHandler.on(document, 'mousedown', ac.internalMousedownHandler, true);
}

// --- Helper Functions ---

const isScrollbarClick = (event, element) => {
    if (!element || event.target !== element) return false;

    // Vertical scrollbar check
    const scrollbarWidth = element.offsetWidth - element.clientWidth;
    if (scrollbarWidth > 0 && event.offsetX >= element.clientWidth) return true;

    // Horizontal scrollbar check (less common for dropdowns, but good practice)
    const scrollbarHeight = element.offsetHeight - element.clientHeight;
    if (scrollbarHeight > 0 && event.offsetY >= element.clientHeight) return true;

    // Fallback check based on coordinates relative to bounding box (covers some edge cases)
    const rect = element.getBoundingClientRect();
    const clickXRelative = event.clientX - rect.left;
    const clickYRelative = event.clientY - rect.top;
    if (clickXRelative > element.clientWidth || clickYRelative > element.clientHeight) return true;

    return false;
};

const handleBlur = (id) => {
    const ac = Data.get(id);
    if (!ac) return;

    setTimeout(() => {
        const currentAc = Data.get(id);
        if (!currentAc) {
            return;
        }
        const relatedTarget = document.activeElement;
        const relatedTargetId = relatedTarget ? relatedTarget.id : 'null';

        if (currentAc.el.contains(relatedTarget)) {
            return;
        }

        if (currentAc.popover) currentAc.popover.hide();
        else currentAc.el.classList.remove('show');

        const shouldTriggerCsharp = currentAc.input.getAttribute('data-bb-blur') === 'true';
        if (shouldTriggerCsharp) {
            try {
                const currentValue = currentAc.input.value;
                currentAc.invoke.invokeMethodAsync('TriggerBlurWithValue', currentValue);
            } catch (error) {
                // Silent fail for disposed instances
            }
        }
    }, 150);
};

// --- MODIFIED handleClickAway ---
const handleClickAway = (event, id) => { // Receives the specific ID
    // Get the data for THIS specific autocomplete instance
    const ac = Data.get(id);

    // Check if this instance exists and is visible
    if (!ac || !ac.el) {
        return;
    }

    const isShown = ac.popover ? ac.popover.isShown() : ac.el.classList.contains('show');

    // Check if THIS component is visible AND the click was outside it
    if (isShown && !ac.el.contains(event.target)) {
        // Check for scrollbar click on THIS component's menu
        if (isScrollbarClick(event, ac.menu)) {
            event.stopPropagation(); // Prevent others (like blur) if needed
            return; // Don't close this one
        }

        // Click was outside this component and not on its scrollbar, hide it
        if (ac.popover) ac.popover.hide();
        else ac.el.classList.remove('show');
    }
};
// --- END MODIFIED handleClickAway ---

const handleMousedown = (event) => { // No need for id param here anymore
    // Find the specific AutoComplete element the mousedown occurred within or is related to
    // Use closest() on the event target to find the parent auto-complete container
    const targetAutoCompleteElement = event.target.closest('.auto-complete');

    // If the mousedown wasn't inside any known auto-complete component, ignore it
    if (!targetAutoCompleteElement) {
        return;
    }

    // Get the ID from the element found
    const targetId = targetAutoCompleteElement.getAttribute('id');
    const ac = Data.get(targetId); // Get data for the AC that was actually interacted with

    // If we don't have data or a menu reference for this specific AC, ignore it
    if (!ac || !ac.menu) {
        return;
    }

    // --- Check 1: Is the mousedown on the scrollbar of THIS AC's menu? ---
    if (isScrollbarClick(event, ac.menu)) {
        event.preventDefault(); // *** Crucial: Prevent input blur ***
        event.stopPropagation(); // Stop further propagation if needed
        return; // Handled
    }

    // --- Check 2: Is the mousedown target inside THIS AC's menu AND is it (or inside) a dropdown item? ---
    const clickedItem = event.target.closest('.dropdown-item');
    // Ensure the item belongs to *this specific* menu
    if (clickedItem && ac.menu.contains(clickedItem)) {
        event.preventDefault(); // *** Crucial: Prevent input blur ***
        // We don't stop propagation here, we want the 'click' event to eventually fire on mouseup
        return; // Handled
    }
};


const handlerKeydown = (ac, e) => {
    const key = e.key;
    const { el, input, invoke, menu, popover } = ac;
    const isShown = popover ? popover.isShown() : el.classList.contains('show');
    // ... (rest of handlerKeydown logic remains the same) ...
    if (key === 'Enter' || key === 'NumpadEnter') {
        const skipEnter = input.getAttribute('data-bb-skip-enter') === 'true';
        if (!skipEnter) {
            e.preventDefault();
            const currentActiveItem = menu.querySelector('.dropdown-item.active');
            if (currentActiveItem) {
                currentActiveItem.click();
            } else {
                invoke.invokeMethodAsync('EnterCallback', input.value)
                    .catch(error => { });
                if (popover) popover.hide(); else el.classList.remove('show');
            }
        }
    }
    else if (key === 'Escape') {
        const skipEsc = input.getAttribute('data-bb-skip-esc') === 'true';
        if (!skipEsc) {
            e.preventDefault();
            invoke.invokeMethodAsync('EscCallback')
                .catch(error => { });
            if (popover) popover.hide(); else el.classList.remove('show');
            input.blur();
        }
    }
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        if (!isShown) {
            showList(ac.el.id);
        }
        const items = [...menu.querySelectorAll('.dropdown-item:not(.disabled)')];
        if (!items.length) return;
        let currentActiveItem = menu.querySelector('.dropdown-item.active');
        let index = currentActiveItem ? items.indexOf(currentActiveItem) : -1;
        if (currentActiveItem) currentActiveItem.classList.remove('active');
        index = key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1) : (index >= items.length - 1 ? 0 : index + 1);
        const nextActiveItem = items[index];
        if (nextActiveItem) {
            nextActiveItem.classList.add('active');
            scrollIntoView(el, nextActiveItem);
        }
    }
    else if (key === 'Tab') {
        const currentActiveItem = menu.querySelector('.dropdown-item.active');
        if (isShown && currentActiveItem) {
            currentActiveItem.click();
        }
    }
}

const scrollIntoView = (el, item) => {
    const input = el.querySelector('input');
    const behaviorAttribute = input?.getAttribute('data-bb-scroll-behavior');
    const behavior = behaviorAttribute === 'auto' ? 'auto' : 'smooth';
    item.scrollIntoView({ behavior: behavior, block: "nearest", inline: "start" });
};

// --- Exported Functions (Callable from C#) ---

export function setValue(id, value) {
    let inputElement = null;
    const ac = Data.get(id);
    inputElement = ac?.input ?? document.getElementById(`${id}_input`);
    if (inputElement) {
        inputElement.value = value ?? "";
    }
}

export function showList(id) {
    const ac = Data.get(id);
    if (ac) {
        if (ac.popover) ac.popover.show();
        else if (ac.el) ac.el.classList.add('show');
    }
}

export function dispose(id) {
    const ac = Data.get(id);
    Data.remove(id);

    if (ac) {
        const { popover, input, menu, internalBlurHandler, internalClickAwayHandler, internalMousedownHandler } = ac;
        if (popover) Popover.dispose(popover);
        if (input) {
            EventHandler.off(input, 'focus');
            EventHandler.off(input, 'keydown');
            if (internalBlurHandler) EventHandler.off(input, 'blur', internalBlurHandler);
            Input.dispose(input);
        }
        if (menu) EventHandler.off(menu, 'click', '.dropdown-item');
        // Remove document-level listeners using the stored references
        if (internalClickAwayHandler) {
            EventHandler.off(document, 'click', internalClickAwayHandler, true);
        }
        if (internalMousedownHandler) {
            EventHandler.off(document, 'mousedown', internalMousedownHandler, true);
        }
    }
}

// Export original Input functions if needed elsewhere
export { handleKeyUp, select, selectAllByFocus, selectAllByEnter };