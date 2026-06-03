import { CircleChevronLeftIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Tells the embedding DooTask shell to close this micro-app. Mirrors the
// postMessage protocol of @dootask/tools' closeApp(), so we avoid an extra
// dependency. This replaces DooTask's floating "capsule" close button, which is
// hidden via the plugin config because it overlaps the Memos header.
function closeDooTaskApp() {
  try {
    window.parent.postMessage(
      {
        type: "MICRO_APP_METHOD",
        message: {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          method: "close",
          args: [false],
        },
      },
      "*",
    );
  } catch {
    // No parent / not embedded — nothing to do.
  }
}

// Only meaningful when running inside the DooTask iframe.
const inDooTask = typeof window !== "undefined" && window.self !== window.top;

const DooTaskClose = ({ collapsed }: { collapsed?: boolean }) => {
  if (!inDooTask) return null;

  const lang = typeof navigator !== "undefined" ? navigator.language : "";
  const label = /^zh/i.test(lang) ? "关闭应用" : "Close app";
  const icon = <CircleChevronLeftIcon className="w-6 h-auto shrink-0" />;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={closeDooTaskApp}
      className={cn(
        "px-2 py-2 rounded-2xl border flex flex-row items-center text-lg text-sidebar-foreground transition-colors cursor-pointer",
        collapsed ? "" : "w-full px-4",
        "border-transparent opacity-80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:border-sidebar-accent-border",
      )}
    >
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
};

export default DooTaskClose;
