import { NonDeletedExcalidrawElement } from "@zsviczian/excalidraw/types/element/types";
import ExcalidrawView from "./ExcalidrawView";
import { Notice, WorkspaceLeaf, WorkspaceSplit } from "obsidian";
import * as React from "react";
import { ConstructableWorkspaceSplit, getContainerForDocument, isObsidianThemeDark } from "./utils/ObsidianUtils";
import { DEVICE, EXTENDED_EVENT_TYPES, KEYBOARD_EVENT_TYPES, TWITTER_REG } from "./Constants";
import { ExcalidrawImperativeAPI, UIAppState } from "@zsviczian/excalidraw/types/types";
import { ObsidianCanvasNode } from "./utils/CanvasNodeFactory";
import { processLinkText, patchMobileView } from "./utils/CustomIFrameUtils";

declare module "obsidian" {
  interface Workspace {
    floatingSplit: any;
  }

  interface WorkspaceSplit {
    containerEl: HTMLDivElement;
  }
}

//--------------------------------------------------------------------------------
//Render webview for anything other than Vimeo and Youtube
//Vimeo and Youtube are rendered by Excalidraw because of the window messaging
//required to control the video
//--------------------------------------------------------------------------------
export const renderWebView = (src: string, radius: number, view: ExcalidrawView, id: string, appState: UIAppState):JSX.Element =>{
  const twitterLink = src.match(TWITTER_REG);
  if (twitterLink) {
    const tweetID = src.match(/.*\/(\d*)\?/)[1];
    if (tweetID) {
      const theme = view.excalidrawData.iFrameTheme === "dark"
      ? "dark"
      : view.excalidrawData.iFrameTheme === "light" 
        ? "light"
        : view.excalidrawData.iFrameTheme === "auto"
          ? appState.theme === "dark" ? "dark" : "light"
          : isObsidianThemeDark() ? "dark" : "light";
      src =`https://platform.twitter.com/embed/Tweet.html?frame=false&hideCard=false&hideThread=false&id=${tweetID}&lang=en&theme=${theme}&width=550px`
    //src = `https://twitframe.com/show?url=${encodeURIComponent(src)}`;
    }
  }

  if(DEVICE.isDesktop && !twitterLink) {
    return (
      <webview
        ref={(ref) => view.updateIFrameRef(id, ref)}
        className="excalidraw__iframe"
        title="Excalidraw Embedded Content"
        allowFullScreen={true}
        src={src}
        style={{
          overflow: "hidden",
          borderRadius: `${radius}px`,
        }}
      />
    );
  }
  return (
    <iframe
      ref={(ref) => view.updateIFrameRef(id, ref)}
      className="excalidraw__iframe"
      title="Excalidraw Embedded Content"
      allowFullScreen={true}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      src={src}
      style={{
        overflow: "hidden",
        borderRadius: `${radius}px`,
      }}
    />
  );
}

//--------------------------------------------------------------------------------
//Render WorkspaceLeaf or CanvasNode
//--------------------------------------------------------------------------------
function RenderObsidianView(
  { element, linkText, radius, view, containerRef, appState, theme }:{
  element: NonDeletedExcalidrawElement;
  linkText: string;
  radius: number;
  view: ExcalidrawView;
  containerRef: React.RefObject<HTMLDivElement>;
  appState: UIAppState;
  theme: string;
}): JSX.Element {
  
  const { subpath, file } = processLinkText(linkText, view);

  if (!file) {
    return null;
  }
  const react = view.plugin.getPackage(view.ownerWindow).react;
  
  //@ts-ignore
  const leafRef = react.useRef<{leaf: WorkspaceLeaf; node?: ObsidianCanvasNode} | null>(null);
  const isEditingRef = react.useRef(false);
  const isActiveRef = react.useRef(false);


  //--------------------------------------------------------------------------------
  //block propagation of events to the parent if the iframe element is active
  //--------------------------------------------------------------------------------
  const stopPropagation = react.useCallback((event:React.PointerEvent<HTMLElement>) => {
    if(isActiveRef.current) {
      event.stopPropagation(); // Stop the event from propagating up the DOM tree
    }
  }, [isActiveRef.current]);

  //runs once after mounting of the component and when the component is unmounted
  react.useEffect(() => {
    if(!containerRef?.current) {
      return;
    }

    KEYBOARD_EVENT_TYPES.forEach((type) => containerRef.current.addEventListener(type, stopPropagation));
    containerRef.current.addEventListener("click", handleClick);

    return () => {
      if(!containerRef?.current) {
        return;
      }
      KEYBOARD_EVENT_TYPES.forEach((type) => containerRef.current.removeEventListener(type, stopPropagation));
      EXTENDED_EVENT_TYPES.forEach((type) => containerRef.current.removeEventListener(type, stopPropagation));
      containerRef.current.removeEventListener("click", handleClick);
    }; //cleanup on unmount
  }, []);

  //blocking or not the propagation of events to the parent if the iframe is active
  react.useEffect(() => {
    EXTENDED_EVENT_TYPES.forEach((type) => containerRef.current.removeEventListener(type, stopPropagation));
    if(!containerRef?.current) {
      return;
    }

    if(isActiveRef.current) {
      EXTENDED_EVENT_TYPES.forEach((type) => containerRef.current.addEventListener(type, stopPropagation));
    }

    return () => {
      if(!containerRef?.current) {
        return;
      }
      EXTENDED_EVENT_TYPES.forEach((type) => containerRef.current.removeEventListener(type, stopPropagation));
    }; //cleanup on unmount
  }, [isActiveRef.current, containerRef.current]);


  //--------------------------------------------------------------------------------
  //mount the workspace leaf or the canvas node depending on subpath
  //--------------------------------------------------------------------------------
  react.useEffect(() => {
    if(!containerRef?.current) {
      return;
    }

    while(containerRef.current.hasChildNodes()) {
      containerRef.current.removeChild(containerRef.current.lastChild);
    }

    const doc = view.ownerDocument;
    const rootSplit:WorkspaceSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(app.workspace, "vertical");
    rootSplit.getRoot = () => app.workspace[doc === document ? 'rootSplit' : 'floatingSplit'];
    rootSplit.getContainer = () => getContainerForDocument(doc);
    rootSplit.containerEl.style.width = '100%';
    rootSplit.containerEl.style.height = '100%';
    rootSplit.containerEl.style.borderRadius = `${radius}px`;
    leafRef.current = {
      leaf: app.workspace.createLeafInParent(rootSplit, 0),
      node: null
    };

    //if subpath is defined, create a canvas node else create a workspace leaf
    if(subpath && view.canvasNodeFactory.isInitialized()) {
      const keepontop = (app.workspace.activeLeaf === view.leaf) && DEVICE.isDesktop;
      if (keepontop) {
        //@ts-ignore
        if(!view.ownerWindow.electronWindow.isAlwaysOnTop()) {
          //@ts-ignore
          view.ownerWindow.electronWindow.setAlwaysOnTop(true);
          setTimeout(() => {
            //@ts-ignore
            view.ownerWindow.electronWindow.setAlwaysOnTop(false);
          }, 150);
        }
      }
      leafRef.current.node = view.canvasNodeFactory.createFileNote(file, subpath, containerRef.current, element.id);
    } else {
      (async () => {
        await leafRef.current.leaf.openFile(file, subpath ? { eState: { subpath }, state: {mode:"preview"} } : undefined);
        const viewType = leafRef.current.leaf.view?.getViewType();
        if(viewType === "canvas") {
          leafRef.current.leaf.view.canvas?.setReadonly(true);
        }
        if ((viewType === "markdown") && view.canvasNodeFactory.isInitialized()) {
          //I haven't found a better way of deciding if an .md file has its own view (e.g., kanban) or not
          //This runs only when the file is added, thus should not be a major performance issue
          await leafRef.current.leaf.setViewState({state: {file:null}})
          leafRef.current.node = view.canvasNodeFactory.createFileNote(file, subpath, containerRef.current, element.id);
        } else {
          const workspaceLeaf:HTMLDivElement = rootSplit.containerEl.querySelector("div.workspace-leaf");
          if(workspaceLeaf) workspaceLeaf.style.borderRadius = `${radius}px`;
          containerRef.current.appendChild(rootSplit.containerEl);
        }
        patchMobileView(view);  
      })();
    }

    return () => {}; //cleanup on unmount
  }, [linkText, subpath, containerRef, radius]);
  
  react.useEffect(() => {
    if(isEditingRef.current) {
      if(leafRef.current?.node) {
        view.canvasNodeFactory.stopEditing(leafRef.current.node);
      }
      isEditingRef.current = false;
    }
  }, [isEditingRef.current, leafRef]);


  //--------------------------------------------------------------------------------
  //Switch to edit mode when markdown view is clicked
  //--------------------------------------------------------------------------------
  const handleClick = react.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if(isActiveRef.current) {
      event.stopPropagation();
    }

    if (isActiveRef.current && !isEditingRef.current && leafRef.current?.leaf) {
      if(leafRef.current.leaf.view?.getViewType() === "markdown") {
        const api:ExcalidrawImperativeAPI = view.excalidrawAPI;
        const el = api.getSceneElements().filter(el=>el.id === element.id)[0];

        if(!el || el.angle !== 0) {
          new Notice("Sorry, cannot edit rotated markdown documents");
          return;
        }
        //@ts-ignore
        const modes = leafRef.current.leaf.view.modes;
        if (!modes) {
          return;
        }
        leafRef.current.leaf.view.setMode(modes['source']);
        isEditingRef.current = true;
        patchMobileView(view);
      } else if (leafRef.current?.node) {
        //Handle canvas node
        view.canvasNodeFactory.startEditing(leafRef.current.node, theme);
      }
    }
  }, [leafRef.current?.leaf, element.id]);

  //--------------------------------------------------------------------------------
  // Set isActiveRef and switch to preview mode when the iframe is not active
  //--------------------------------------------------------------------------------
  react.useEffect(() => {
    if(!containerRef?.current || !leafRef?.current) {
      return;
    }

    const previousIsActive = isActiveRef.current;
    isActiveRef.current = (appState.activeIFrame?.element.id === element.id) && (appState.activeIFrame?.state === "active");

    if (previousIsActive === isActiveRef.current) {
      return;
    }

    if(leafRef.current.leaf?.view?.getViewType() === "markdown") {
      //Handle markdown leaf
      //@ts-ignore
      const modes = leafRef.current.leaf.view.modes;
      if(!modes) {
        return;
      }
    
      if(!isActiveRef.current) {
        //@ts-ignore
        leafRef.current.leaf.view.setMode(modes["preview"]);
        isEditingRef.current = false;
        return;
      }  
    } else if (leafRef.current?.node) {
      //Handle canvas node
      view.canvasNodeFactory.stopEditing(leafRef.current.node);
    }
  }, [
    containerRef,
    leafRef,
    isActiveRef,
    appState.activeIFrame?.element,
    appState.activeIFrame?.state,
    element,
    view,
    linkText,
    subpath,
    file,
    theme,
    isEditingRef,
    view.canvasNodeFactory
  ]);

  return null;
};

export const CustomIFrame: React.FC<{element: NonDeletedExcalidrawElement; radius: number; view: ExcalidrawView; appState: UIAppState; linkText: string}> = ({ element, radius, view, appState, linkText }) => {
  const react = view.plugin.getPackage(view.ownerWindow).react;
  const containerRef: React.RefObject<HTMLDivElement> = react.useRef(null);
  const theme = view.excalidrawData.iFrameTheme === "dark"
    ? "theme-dark"
    : view.excalidrawData.iFrameTheme === "light" 
      ? "theme-light"
      : view.excalidrawData.iFrameTheme === "auto"
        ? appState.theme === "dark" ? "theme-dark" : "theme-light"
        : isObsidianThemeDark() ? "theme-dark" : "theme-light";

  return (
    <div
      ref={containerRef}
      style = {{
        width: `100%`,
        height: `100%`,
        borderRadius: `${radius}px`,
        color: `var(--text-normal)`,
      }}
      className={theme}
    >
      <RenderObsidianView
        element={element}
        linkText={linkText}
        radius={radius}
        view={view}
        containerRef={containerRef}
        appState={appState}
        theme={theme}/>
    </div>
  )
}