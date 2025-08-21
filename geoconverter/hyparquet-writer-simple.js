// hyparquet-writer simple browser bundle
// This is a simplified version that works in browsers without external dependencies

// Constants from hyparquet that we need
const Encoding = {
  PLAIN: 'PLAIN',
  RLE: 'RLE',
  PLAIN_DICTIONARY: 'PLAIN_DICTIONARY',
  RLE_DICTIONARY: 'RLE_DICTIONARY'
}

const PageType = {
  DATA_PAGE: 'DATA_PAGE',
  DATA_PAGE_V2: 'DATA_PAGE_V2'
}

// ByteWriter implementation
function ByteWriter() {
  this.buffer = new ArrayBuffer(1024)
  this.view = new DataView(this.buffer)
  this.offset = 0
  this.index = 0
  return this
}

ByteWriter.prototype.ensure = function(size) {
  if (this.index + size > this.buffer.byteLength) {
    const newSize = Math.max(this.buffer.byteLength * 2, this.index + size)
    const newBuffer = new ArrayBuffer(newSize)
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer))
    this.buffer = newBuffer
    this.view = new DataView(this.buffer)
  }
}

ByteWriter.prototype.finish = function() {}

ByteWriter.prototype.getBuffer = function() {
  return this.buffer.slice(0, this.index)
}

ByteWriter.prototype.appendUint8 = function(value) {
  this.ensure(1)
  this.view.setUint8(this.index, value)
  this.offset++
  this.index++
}

ByteWriter.prototype.appendUint32 = function(value) {
  this.ensure(4)
  this.view.setUint32(this.index, value, true)
  this.offset += 4
  this.index += 4
}

ByteWriter.prototype.appendInt32 = function(value) {
  this.ensure(4)
  this.view.setInt32(this.index, value, true)
  this.offset += 4
  this.index += 4
}

ByteWriter.prototype.appendInt64 = function(value) {
  this.ensure(8)
  this.view.setBigInt64(this.index, BigInt(value), true)
  this.offset += 8
  this.index += 8
}

ByteWriter.prototype.appendFloat32 = function(value) {
  this.ensure(4)
  this.view.setFloat32(this.index, value, true)
  this.offset += 4
  this.index += 4
}

ByteWriter.prototype.appendFloat64 = function(value) {
  this.ensure(8)
  this.view.setFloat64(this.index, value, true)
  this.offset += 8
  this.index += 8
}

ByteWriter.prototype.appendBuffer = function(buffer) {
  const bytes = new Uint8Array(buffer)
  this.ensure(bytes.length)
  new Uint8Array(this.buffer).set(bytes, this.index)
  this.offset += bytes.length
  this.index += bytes.length
}

ByteWriter.prototype.appendBytes = function(bytes) {
  this.ensure(bytes.length)
  new Uint8Array(this.buffer).set(bytes, this.index)
  this.offset += bytes.length
  this.index += bytes.length
}

ByteWriter.prototype.appendVarInt = function(value) {
  while (value >= 0x80) {
    this.appendUint8((value & 0x7F) | 0x80)
    value >>>= 7
  }
  this.appendUint8(value & 0x7F)
}

ByteWriter.prototype.appendVarBigInt = function(value) {
  const bigValue = BigInt(value)
  while (bigValue >= 0x80n) {
    this.appendUint8(Number((bigValue & 0x7Fn) | 0x80n))
    value = bigValue >> 7n
  }
  this.appendUint8(Number(bigValue & 0x7Fn))
}

// Simple schema generation
function schemaFromColumnData({ columnData }) {
  const schema = []
  
  for (const column of columnData) {
    const element = {
      name: column.name,
      type: column.type || inferType(column.data),
      repetition_type: column.nullable ? 'OPTIONAL' : 'REQUIRED'
    }
    schema.push(element)
  }
  
  return schema
}

function inferType(data) {
  if (data.length === 0) return 'STRING'
  
  const sample = data[0]
  if (typeof sample === 'boolean') return 'BOOLEAN'
  if (typeof sample === 'number') {
    if (Number.isInteger(sample)) {
      return sample > 2147483647 ? 'INT64' : 'INT32'
    }
    return 'DOUBLE'
  }
  if (typeof sample === 'bigint') return 'INT64'
  if (typeof sample === 'string') return 'STRING'
  
  return 'STRING'
}

// Simple parquet writer
function parquetWriteBuffer(options) {
  const { columnData, schema, compressed = true, statistics = true, rowGroupSize = 100000 } = options
  
  const finalSchema = schema || schemaFromColumnData({ columnData })
  const writer = new ByteWriter()
  
  // Write parquet magic
  writer.appendBytes(new TextEncoder().encode('PAR1'))
  
  // Write a simple row group
  writeRowGroup(writer, columnData, finalSchema, compressed, statistics)
  
  // Write footer
  writeFooter(writer, finalSchema, writer.offset)
  
  // Write footer length
  writer.appendUint32(writer.offset)
  
  // Write magic again
  writer.appendBytes(new TextEncoder().encode('PAR1'))
  
  return writer.getBuffer()
}

function writeRowGroup(writer, columnData, schema, compressed, statistics) {
  const rowCount = columnData[0].data.length
  
  // Write row group header
  writer.appendUint32(rowCount) // num_rows
  
  // Write column chunks
  for (let i = 0; i < columnData.length; i++) {
    writeColumnChunk(writer, columnData[i], schema[i], compressed, statistics)
  }
}

function writeColumnChunk(writer, column, schemaElement, compressed, statistics) {
  // Write column chunk header
  writer.appendUint32(0) // file_offset (placeholder)
  writer.appendUint32(0) // meta_data_length (placeholder)
  writer.appendUint32(0) // data_page_offset (placeholder)
  
  // Write data page
  writeDataPage(writer, column, schemaElement, compressed, statistics)
}

function writeDataPage(writer, column, schemaElement, compressed, statistics) {
  const data = column.data
  const nonNullData = data.filter(v => v !== null && v !== undefined)
  
  // Write page header
  writer.appendUint32(PageType.DATA_PAGE_V2)
  writer.appendUint32(nonNullData.length) // num_values
  writer.appendUint32(0) // num_nulls
  writer.appendUint32(0) // num_rows
  writer.appendUint32(0) // encoding
  writer.appendUint32(0) // definition_levels_byte_length
  writer.appendUint32(0) // repetition_levels_byte_length
  writer.appendUint32(0) // is_compressed
  
  // Write data (simplified - just write raw values)
  for (const value of nonNullData) {
    writeValue(writer, value, schemaElement.type)
  }
}

function writeValue(writer, value, type) {
  switch (type) {
    case 'BOOLEAN':
      writer.appendUint8(value ? 1 : 0)
      break
    case 'INT32':
      writer.appendInt32(value)
      break
    case 'INT64':
      writer.appendInt64(value)
      break
    case 'FLOAT':
      writer.appendFloat32(value)
      break
    case 'DOUBLE':
      writer.appendFloat64(value)
      break
    case 'STRING':
      const bytes = new TextEncoder().encode(value)
      writer.appendVarInt(bytes.length)
      writer.appendBytes(bytes)
      break
    default:
      writer.appendUint8(0)
  }
}

function writeFooter(writer, schema, dataLength) {
  // Write schema
  writer.appendUint32(schema.length)
  for (const element of schema) {
    writer.appendVarInt(element.name.length)
    writer.appendBytes(new TextEncoder().encode(element.name))
    writer.appendVarInt(element.type.length)
    writer.appendBytes(new TextEncoder().encode(element.type))
    writer.appendVarInt(element.repetition_type.length)
    writer.appendBytes(new TextEncoder().encode(element.repetition_type))
  }
  
  // Write metadata
  writer.appendUint32(0) // num_rows
  writer.appendUint32(0) // row_groups_length
  writer.appendUint32(0) // key_value_metadata_length
}

// Export the main functions
export { parquetWriteBuffer, ByteWriter, schemaFromColumnData }

// Browser utility functions
export function downloadParquetFile(arrayBuffer, filename = 'data.parquet') {
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function createParquetBlob(arrayBuffer) {
  return new Blob([arrayBuffer], { type: 'application/octet-stream' })
}
