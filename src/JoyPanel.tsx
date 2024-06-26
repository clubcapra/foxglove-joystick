import { fromDate } from "@foxglove/rostime";
import {
  Immutable,
  MessageEvent,
  PanelExtensionContext,
  Topic,
  SettingsTreeAction,
} from "@foxglove/studio";
import { FormGroup, FormControlLabel, Switch } from "@mui/material";
import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { GamepadView } from "./components/GamepadView";
import { SimpleButtonView } from "./components/SimpleButtonView";
import kbmapping1 from "./components/kbmapping1.json";
import { useGamepad } from "./hooks/useGamepad";
import { Config, buildSettingsTree, settingsActionReducer } from "./panelSettings";
import { Joy } from "./types";

type KbMap = {
  button: number;
  axis: number;
  direction: number;
  value: number;
};

function JoyPanel({ context }: { context: PanelExtensionContext }): JSX.Element {
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [joy, setJoy] = useState<Joy | undefined>();
  const [pubTopic, setPubTopic] = useState<string | undefined>();
  const [kbEnabled, setKbEnabled] = useState<boolean>(true);
  const [trackedKeys, setTrackedKeys] = useState<Map<string, KbMap> | undefined>(() => {
    const keyMap = new Map<string, KbMap>();

    for (const [key, value] of Object.entries(kbmapping1)) {
      const k: KbMap = {
        button: value.button,
        axis: value.axis,
        direction: value.direction === "+" ? 1 : 0,
        value: 0,
      };
      keyMap.set(key, k);
    }
    return keyMap;
  });

  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Partial<Config>;
    partialConfig.subJoyTopic ??= "/joy";
    partialConfig.pubJoyTopic ??= "/joy";
    partialConfig.publishMode ??= false;
    partialConfig.publishFrameId ??= "";
    partialConfig.dataSource ??= "sub-joy-topic";
    partialConfig.displayMode ??= "auto";
    partialConfig.debugGamepad ??= false;
    partialConfig.layoutName ??= "steamdeck";
    partialConfig.mapping_name ??= "TODO";
    partialConfig.gamepadId ??= 0;
    return partialConfig as Config;
  });

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
    },
    [setConfig],
  );

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(config, topics),
    });
  }, [config, context, settingsActionHandler, topics]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setTopics(renderState.topics);
      setMessages(renderState.currentFrame);
    };

    context.watch("topics");
    context.watch("currentFrame");
  }, [context]);

  useEffect(() => {
    if (config.dataSource === "sub-joy-topic") {
      context.subscribe([config.subJoyTopic]);
    } else {
      context.unsubscribeAll();
    }
  }, [config.subJoyTopic, context, config.dataSource]);

  useEffect(() => {
    const latestJoy = messages?.[messages.length - 1]?.message as Joy | undefined;
    if (latestJoy) {
      const tmpMsg = {
        header: {
          stamp: latestJoy.header.stamp,
          frame_id: config.publishFrameId,
        },
        axes: Array.from(latestJoy.axes),
        buttons: Array.from(latestJoy.buttons),
      };
      setJoy(tmpMsg);
    }
  }, [messages, config.publishFrameId]);

  useGamepad({
    didConnect: useCallback((gp: Gamepad) => {
      console.log("Gamepad " + gp.index + " connected!");
    }, []),

    didDisconnect: useCallback((gp: Gamepad) => {
      console.log("Gamepad " + gp.index + " disconnected!");
    }, []),

    didUpdate: useCallback(
      (gp: Gamepad) => {
        if (config.dataSource !== "gamepad") {
          return;
        }

        if (config.gamepadId !== gp.index) {
          return;
        }

        const tmpJoy = {
          header: {
            frame_id: config.publishFrameId,
            stamp: fromDate(new Date()),
          },
          axes: gp.axes.map((axis) => -axis),
          buttons: gp.buttons.map((button) => (button.pressed ? 1 : 0)),
        } as Joy;

        setJoy(tmpJoy);
      },
      [config.dataSource, config.gamepadId, config.publishFrameId],
    ),
  });

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    setTrackedKeys((oldTrackedKeys) => {
      if (oldTrackedKeys && oldTrackedKeys.has(event.key)) {
        const newKeys = new Map(oldTrackedKeys);
        const k = newKeys.get(event.key);
        if (k) {
          k.value = 1;
        }
        return newKeys;
      }
      return oldTrackedKeys;
    });
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    setTrackedKeys((oldTrackedKeys) => {
      if (oldTrackedKeys && oldTrackedKeys.has(event.key)) {
        const newKeys = new Map(oldTrackedKeys);
        const k = newKeys.get(event.key);
        if (k) {
          k.value = 0;
        }
        return newKeys;
      }
      return oldTrackedKeys;
    });
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyUp]);

  useEffect(() => {
    if (config.dataSource !== "keyboard") {
      return;
    }
    if (!kbEnabled) {
      return;
    }

    const axes: number[] = [];
    const buttons: number[] = [];

    trackedKeys?.forEach((value) => {
      if (value.button >= 0) {
        while (buttons.length <= value.button) {
          buttons.push(0);
        }
        buttons[value.button] = value.value;
      } else if (value.axis >= 0) {
        while (axes.length <= value.axis) {
          axes.push(0);
        }
        axes[value.axis] += (value.direction > 0 ? 1 : -1) * value.value;
      }
    });

    const tmpJoy = {
      header: {
        frame_id: config.publishFrameId,
        stamp: fromDate(new Date()),
      },
      axes,
      buttons,
    } as Joy;

    setJoy(tmpJoy);
  }, [config.dataSource, trackedKeys, config.publishFrameId, kbEnabled]);

  useEffect(() => {
    if (config.publishMode) {
      setPubTopic((oldTopic) => {
        if (oldTopic) {
          context.unadvertise?.(oldTopic);
        }
        context.advertise?.(config.pubJoyTopic, "sensor_msgs/Joy");
        return config.pubJoyTopic;
      });
    }
  }, [config.pubJoyTopic, config.publishMode, context]);

  useEffect(() => {
    if (!config.publishMode) {
      return;
    }

    if (pubTopic && pubTopic === config.pubJoyTopic) {
      context.publish?.(pubTopic, joy);
    }
  }, [context, config.pubJoyTopic, config.publishMode, joy, pubTopic]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const handleKbSwitch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setKbEnabled(event.target.checked);
  };

  const interactiveCb = useCallback(
    (interactiveJoy: Joy) => {
      if (config.dataSource !== "interactive") {
        return;
      }
      const tmpJoy = {
        header: {
          frame_id: config.publishFrameId,
          stamp: fromDate(new Date()),
        },
        axes: interactiveJoy.axes,
        buttons: interactiveJoy.buttons,
      } as Joy;

      setJoy(tmpJoy);
    },
    [config.publishFrameId, config.dataSource, setJoy],
  );

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

  return (
    <div>
      {config.dataSource === "keyboard" ? (
        <FormGroup>
          <FormControlLabel
            control={<Switch checked={kbEnabled} onChange={handleKbSwitch} />}
            label="Enable Keyboard"
          />
        </FormGroup>
      ) : null}
      {config.displayMode === "auto" ? <SimpleButtonView joy={joy} /> : null}
      {config.displayMode === "custom" ? (
        <GamepadView joy={joy} cbInteractChange={interactiveCb} layoutName={config.layoutName} />
      ) : null}
    </div>
  );
}

export function initJoyPanel(context: PanelExtensionContext): () => void {
  ReactDOM.render(<JoyPanel context={context} />, context.panelElement);

  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
