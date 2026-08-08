# Remotion Lower Third Fixture

This lower third follows the only supported motion-graphics execution path:

`Remotion TSX -> Canvas remotion-component -> Timeline sourceNodeId -> Timeline render`

`LowerThird.tsx` is the editable working-tree source. Persist its exact contents
as a distinct Canvas node and keep the returned node ID stable:

```bash
clash canvas add \
  --type remotion \
  --label "CWD principle lower third" \
  --content "$(cat examples/remotion/lower-third/LowerThird.tsx)" \
  --json
REMOTION_NODE_ID="paste-returned-node-id"
clash canvas get --node "$REMOTION_NODE_ID" --json
```

Replace `replace-with-returned-remotion-node-id` in
`lower-third.timeline.yaml` with that exact ID. Create or reuse a Timeline,
pull it before editing, and merge the composition item into the complete
Timeline state:

```bash
clash timeline create --id lower-third-demo --name "Lower third demo" --json
clash timeline pull --timeline lower-third-demo --json
# Merge the example item into timelines/lower-third-demo.timeline.yaml and set
# sourceNodeId to the returned Canvas node ID.
clash timeline validate --file timelines/lower-third-demo.timeline.yaml --json
clash timeline apply \
  --timeline lower-third-demo \
  --file timelines/lower-third-demo.timeline.yaml \
  --json
clash timeline pull --timeline lower-third-demo --json
clash timeline render --timeline lower-third-demo --json
```

The Editor previews the component from the Canvas node. Final media is produced
only by rendering the persisted Timeline. The Timeline stores the stable
`sourceNodeId`, not a copy of the TSX; updating the same Canvas node therefore
updates subsequent previews and renders after the normal read-before-write
check.
