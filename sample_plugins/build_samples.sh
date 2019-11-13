SAMPLE_DIR=$(dirname "${BASH_SOURCE[0]}")
tsc --build ${SAMPLE_DIR}/node_view/tsconfig.json
tsc --build ${SAMPLE_DIR}/namespace_view/tsconfig.json
