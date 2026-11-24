import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { Avatar } from "@/components/Avatar";
import { usePaletteColors } from "@/lib/theme";
import { CARD_H, CARD_W, type TreeLayout } from "@/lib/treeLayout";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const PADDING = 40;

export type CardInfo = {
  name: string;
  photo?: { url: string; key: string } | null;
  relation: string | null;
  years: string | null;
};

export type TreeCanvasHandle = {
  zoomBy: (factor: number) => void;
  /** Fit the whole tree on screen. */
  fit: () => void;
  /** Centre the view on the focus person. */
  centre: () => void;
};

type Props = {
  layout: TreeLayout;
  cardInfo: (personId: string) => CardInfo;
  onOpen: (personId: string) => void;
  onRecentre: (personId: string) => void;
};

/**
 * Draws a TreeLayout: connector lines in SVG underneath, person cards on top.
 * Drag to move, pinch to zoom (zoom buttons work everywhere, including the web).
 * The movement runs on the UI thread (Reanimated), so it stays smooth.
 */
export const TreeCanvas = forwardRef<TreeCanvasHandle, Props>(function TreeCanvas(
  { layout, cardInfo, onOpen, onRecentre },
  ref,
) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const colors = usePaletteColors();
  const lineColor = {
    parent: colors.gray[colors.dark ? "600" : "400"],
    partner: colors.accent["400"],
    friend: colors.gray[colors.dark ? "700" : "300"],
  };
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  // Content coordinates: shift so the top-left card starts at (PADDING, PADDING).
  const offsetX = PADDING - layout.bounds.minX;
  const offsetY = PADDING - layout.bounds.minY;
  const contentW = layout.bounds.maxX - layout.bounds.minX + PADDING * 2;
  const contentH = layout.bounds.maxY - layout.bounds.minY + PADDING * 2;

  const centre = useCallback(
    (animate = true) => {
      if (!viewport.width) return;
      const s = Math.min(1, scale.value);
      // The focus card's top-left is (0, 0) in layout coordinates.
      const x = viewport.width / 2 - (offsetX + CARD_W / 2) * s;
      const y = viewport.height / 2 - (offsetY + CARD_H / 2) * s;
      tx.value = animate ? withTiming(x) : x;
      ty.value = animate ? withTiming(y) : y;
      scale.value = animate ? withTiming(s) : s;
    },
    [viewport, offsetX, offsetY, tx, ty, scale],
  );

  const fit = useCallback(() => {
    if (!viewport.width) return;
    const s = Math.max(MIN_SCALE, Math.min(1, viewport.width / contentW, viewport.height / contentH));
    tx.value = withTiming((viewport.width - contentW * s) / 2);
    ty.value = withTiming((viewport.height - contentH * s) / 2);
    scale.value = withTiming(s);
  }, [viewport, contentW, contentH, tx, ty, scale]);

  const zoomBy = useCallback(
    (factor: number) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value * factor));
      // Keep the middle of the screen where it is.
      const cx = viewport.width / 2;
      const cy = viewport.height / 2;
      tx.value = withTiming(cx - (cx - tx.value) * (next / scale.value));
      ty.value = withTiming(cy - (cy - ty.value) * (next / scale.value));
      scale.value = withTiming(next);
    },
    [viewport, tx, ty, scale],
  );

  useImperativeHandle(ref, () => ({ zoomBy, fit, centre: () => centre(true) }), [zoomBy, fit, centre]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const first = viewport.width === 0;
    setViewport({ width, height });
    if (first) {
      // Start centred on the focus person, at normal size.
      tx.value = width / 2 - (offsetX + CARD_W / 2);
      ty.value = height / 2 - (offsetY + CARD_H / 2);
    }
  };

  const pan = usePanGesture({
    minDistance: 6, // so a tap on a card still counts as a tap
    onUpdate: (e) => {
      "worklet";
      tx.value += e.changeX;
      ty.value += e.changeY;
    },
  });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value * e.scaleChange));
      // Zoom around the point between the fingers.
      tx.value = e.focalX - (e.focalX - tx.value) * (next / scale.value);
      ty.value = e.focalY - (e.focalY - ty.value) * (next / scale.value);
      scale.value = next;
    },
  });

  const gestures = useSimultaneousGestures(pan, pinch);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const pathOf = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x + offsetX} ${y + offsetY}`).join(" ");

  return (
    <GestureDetector gesture={gestures}>
      <View className="flex-1 overflow-hidden bg-gray-100 dark:bg-gray-950" onLayout={onLayout}>
        <Animated.View
          style={[{ width: contentW, height: contentH, transformOrigin: "0 0" }, contentStyle]}
        >
          <Svg width={contentW} height={contentH} style={{ position: "absolute", left: 0, top: 0 }}>
            {layout.edges.map((edge) => (
              <Path
                key={edge.key}
                d={pathOf(edge.points)}
                stroke={lineColor[edge.kind]}
                strokeWidth={edge.kind === "partner" ? 2.5 : 1.5}
                strokeDasharray={edge.kind === "friend" ? "6 5" : undefined}
                fill="none"
              />
            ))}
          </Svg>

          {layout.nodes.map((node) => {
            const info = cardInfo(node.personId);
            return (
              <Pressable
                key={node.key}
                onPress={() => onOpen(node.personId)}
                onLongPress={() => onRecentre(node.personId)}
                delayLongPress={450}
                accessibilityRole="button"
                accessibilityLabel={[info.name, info.relation, info.years].filter(Boolean).join(", ")}
                style={{ position: "absolute", left: node.x + offsetX, top: node.y + offsetY, width: CARD_W, height: CARD_H }}
                className={`justify-center rounded-xl px-2 active:opacity-70 ${
                  node.role === "focus"
                    ? "border-2 border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
                    : node.role === "friend"
                      ? "border border-dashed border-gray-400 bg-white dark:bg-gray-900"
                      : "border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
                }`}
              >
                <View className="flex-row items-center gap-2">
                  <Avatar name={info.name} photo={info.photo} size={36} />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {info.name}
                    </Text>
                    {info.relation ? (
                      <Text numberOfLines={1} className="text-xs text-indigo-700 dark:text-indigo-300">
                        {info.relation}
                      </Text>
                    ) : null}
                    {info.years ? (
                      <Text numberOfLines={1} className="text-xs text-gray-500">
                        {info.years}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
  );
});
