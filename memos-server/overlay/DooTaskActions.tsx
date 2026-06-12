import { isMainElectron } from "@dootask/tools";
import { CircleChevronLeftIcon, PictureInPicture2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Talk to the embedding DooTask shell. Mirrors @dootask/tools' postMessage
// protocol (fire-and-forget) so these don't depend on the ready handshake. They
// replace DooTask's floating "capsule", hidden by the plugin config because it
// overlaps the Memos header.
function callParent(method: string, args: unknown[]) {
  try {
    window.parent.postMessage(
      {
        type: "MICRO_APP_METHOD",
        message: {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          method,
          args,
        },
      },
      "*",
    );
  } catch {
    // No parent / not embedded — nothing to do.
  }
}

function dismissDrawer() {
  // The mobile navigation drawer is a Radix Sheet that closes on Escape.
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  } catch {
    // ignore
  }
}

const inDooTask = typeof window !== "undefined" && window.self !== window.top;

const DooTaskActions = ({ collapsed }: { collapsed?: boolean }) => {
  // "Open in new window" only applies in the desktop client's main window
  // (not the web client, not an already popped-out window): isMainElectron.
  const [canPopout, setCanPopout] = useState(false);
  useEffect(() => {
    if (!inDooTask) return;
    isMainElectron()
      .then(setCanPopout)
      .catch(() => setCanPopout(false));
  }, []);

  if (!inDooTask) return null;

  // Follow the synced Memos language (falls back to the browser language).
  let locale = typeof navigator !== "undefined" ? navigator.language : "";
  try {
    locale = localStorage.getItem("memos-locale") || locale;
  } catch {
    // ignore
  }
  const zh = /^zh/i.test(locale);
  const itemClass = cn(
    "px-2 py-2 rounded-2xl border flex flex-row items-center text-lg text-sidebar-foreground transition-colors cursor-pointer",
    collapsed ? "" : "w-full px-4",
    "border-transparent opacity-80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:border-sidebar-accent-border",
  );

  const renderItem = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button type="button" aria-label={label} onClick={onClick} className={itemClass}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{icon}</div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        icon
      )}
      {!collapsed && <span className="ml-3 truncate">{label}</span>}
    </button>
  );

  return (
    <>
      {canPopout &&
        renderItem(
          <PictureInPicture2Icon className="w-6 h-auto shrink-0" />,
          zh ? "新窗口打开" : "Open in new window",
          () => callParent("popoutWindow", [{}]),
        )}
      {renderItem(<CircleChevronLeftIcon className="w-6 h-auto shrink-0" />, zh ? "关闭应用" : "Close app", () => {
        dismissDrawer();
        callParent("close", [false]);
      })}
    </>
  );
};

export default DooTaskActions;
